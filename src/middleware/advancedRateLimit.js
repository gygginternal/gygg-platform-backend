import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import redisManager from '../config/redis.js';
import alertingService from '../services/alertingService.js';
import { logSecurityEvent, logSuspiciousActivity, SECURITY_EVENTS } from '../utils/securityLogger.js';
import AppError from '../utils/AppError.js';

// Create store based on Redis availability
const createStore = () => {
  if (redisManager.isConnected) {
    return new RedisStore({
      sendCommand: (...args) => redisManager.client.call(...args),
      prefix: 'rate_limit:',
    });
  }
  return undefined; // Use default memory store
};

// Enhanced rate limit handler with security logging and alerting
const createRateLimitHandler = (identifier) => (req, res) => {
  const clientInfo = {
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: req.user?.id,
    endpoint: req.originalUrl,
    method: req.method
  };

  // Log rate limit exceeded
  logSecurityEvent(SECURITY_EVENTS.RATE_LIMIT_EXCEEDED, {
    identifier,
    ...clientInfo,
    timestamp: new Date().toISOString()
  });

  // Trigger alerting for rate limit violations
  alertingService.processSecurityEvent('rateLimitViolations', {
    identifier,
    ...clientInfo
  });

  // Check for suspicious patterns
  const suspiciousPatterns = [
    req.get('User-Agent')?.includes('bot'),
    req.get('User-Agent')?.includes('crawler'),
    !req.get('User-Agent'), // No user agent
    req.originalUrl.includes('admin'),
    req.originalUrl.includes('api/v')
  ];

  if (suspiciousPatterns.some(Boolean)) {
    logSuspiciousActivity(req.user?.id || 'anonymous', 'suspicious_rate_limit_pattern', {
      ...clientInfo,
      patterns: suspiciousPatterns.map((p, i) => p ? i : null).filter(Boolean)
    });

    // Trigger suspicious activity alert
    alertingService.processSecurityEvent('suspiciousActivity', {
      type: 'suspicious_rate_limit_pattern',
      ...clientInfo,
      patterns: suspiciousPatterns.map((p, i) => p ? i : null).filter(Boolean)
    });
  }

  res.status(429).json({
    status: 'error',
    message: 'Too many requests, please try again later',
    retryAfter: Math.round(req.rateLimit.resetTime / 1000)
  });
};

// Skip rate limiting for certain conditions
const skipRateLimit = (req) => {
  // Skip for health checks
  if (req.originalUrl === '/health' || req.originalUrl === '/api/health') {
    return true;
  }

  // Skip for admin users in development
  if (process.env.NODE_ENV === 'development' && req.user?.role?.includes('admin')) {
    return true;
  }

  // Skip for whitelisted IPs
  const whitelistedIPs = process.env.RATE_LIMIT_WHITELIST?.split(',') || [];
  if (whitelistedIPs.includes(req.ip)) {
    return true;
  }

  return false;
};

// Key generator for rate limiting
const generateKey = (req) => {
  // Use user ID if authenticated, otherwise IP
  const baseKey = req.user?.id || req.ip;
  const endpoint = req.route?.path || req.originalUrl;
  return `${baseKey}:${endpoint}`;
};

// Different rate limit configurations
const rateLimitConfigs = {
  // General API rate limit
  general: rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // Limit each user/IP to 1000 requests per windowMs
    message: 'Too many requests from this IP, please try again later',
    standardHeaders: true,
    legacyHeaders: false,
    store: createStore(),
    keyGenerator: generateKey,
    skip: skipRateLimit,
    handler: createRateLimitHandler('general')
  }),

  // Strict rate limit for authentication endpoints
  auth: rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Limit each IP to 10 auth requests per windowMs
    message: 'Too many authentication attempts, please try again later',
    standardHeaders: true,
    legacyHeaders: false,
    store: createStore(),
    keyGenerator: (req) => req.ip, // Always use IP for auth
    skipSuccessfulRequests: true, // Don't count successful requests
    handler: createRateLimitHandler('auth')
  }),

  // Password reset rate limiting
  passwordReset: rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3, // Limit each IP to 3 password reset requests per hour
    message: 'Too many password reset attempts, please try again later',
    standardHeaders: true,
    legacyHeaders: false,
    store: createStore(),
    keyGenerator: (req) => req.ip,
    handler: createRateLimitHandler('password_reset')
  }),

  // File upload rate limiting
  upload: rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 50, // Limit each user to 50 uploads per hour
    message: 'Too many file uploads, please try again later',
    standardHeaders: true,
    legacyHeaders: false,
    store: createStore(),
    keyGenerator: generateKey,
    handler: createRateLimitHandler('upload')
  }),

  // Payment endpoints rate limiting
  payment: rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 20, // Limit each user to 20 payment operations per hour
    message: 'Too many payment requests, please try again later',
    standardHeaders: true,
    legacyHeaders: false,
    store: createStore(),
    keyGenerator: generateKey,
    handler: createRateLimitHandler('payment')
  }),

  // Admin endpoints rate limiting
  admin: rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 200, // Higher limit for admin operations
    message: 'Too many admin requests, please try again later',
    standardHeaders: true,
    legacyHeaders: false,
    store: createStore(),
    keyGenerator: generateKey,
    handler: createRateLimitHandler('admin')
  }),

  // Search endpoints rate limiting
  search: rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 30, // Limit search requests to prevent abuse
    message: 'Too many search requests, please try again later',
    standardHeaders: true,
    legacyHeaders: false,
    store: createStore(),
    keyGenerator: generateKey,
    handler: createRateLimitHandler('search')
  }),

  // Webhook endpoints (more permissive for external services)
  webhook: rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 100, // Higher limit for webhooks
    message: 'Webhook rate limit exceeded',
    standardHeaders: true,
    legacyHeaders: false,
    store: createStore(),
    keyGenerator: (req) => req.ip,
    handler: createRateLimitHandler('webhook')
  }),

  // AI matching endpoints
  aiMatching: rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // Limit AI matching requests (computationally expensive)
    message: 'Too many AI matching requests, please try again later',
    standardHeaders: true,
    legacyHeaders: false,
    store: createStore(),
    keyGenerator: generateKey,
    handler: createRateLimitHandler('ai_matching')
  })
};

// Middleware to apply different rate limits based on endpoint
const smartRateLimit = (req, res, next) => {
  const path = req.originalUrl.toLowerCase();
  
  // Determine which rate limit to apply
  let rateLimiter = rateLimitConfigs.general;
  
  if (path.includes('/auth/') || path.includes('/login') || path.includes('/register')) {
    rateLimiter = rateLimitConfigs.auth;
  } else if (path.includes('/forgot-password') || path.includes('/reset-password')) {
    rateLimiter = rateLimitConfigs.passwordReset;
  } else if (path.includes('/upload') || path.includes('/file')) {
    rateLimiter = rateLimitConfigs.upload;
  } else if (path.includes('/payment') || path.includes('/stripe')) {
    rateLimiter = rateLimitConfigs.payment;
  } else if (path.includes('/admin')) {
    rateLimiter = rateLimitConfigs.admin;
  } else if (path.includes('/search')) {
    rateLimiter = rateLimitConfigs.search;
  } else if (path.includes('/webhook')) {
    rateLimiter = rateLimitConfigs.webhook;
  } else if (path.includes('/ai-matching') || path.includes('/matching')) {
    rateLimiter = rateLimitConfigs.aiMatching;
  }
  
  rateLimiter(req, res, next);
};

// Progressive rate limiting - increases restrictions for repeat offenders
const progressiveRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: (req) => {
    // Check if this IP has been rate limited recently
    const violations = req.rateLimit?.totalHits || 0;
    
    if (violations > 1000) return 10; // Severe restriction
    if (violations > 500) return 50;  // Moderate restriction
    if (violations > 100) return 200; // Light restriction
    
    return 1000; // Normal limit
  },
  message: 'Rate limit exceeded - restrictions increased due to previous violations',
  standardHeaders: true,
  legacyHeaders: false,
  store: createStore(),
  keyGenerator: (req) => req.ip,
  handler: createRateLimitHandler('progressive')
});

// Burst protection - very short window with low limit
const burstProtection = rateLimit({
  windowMs: 1000, // 1 second
  max: 10, // Max 10 requests per second
  message: 'Request burst detected, please slow down',
  standardHeaders: true,
  legacyHeaders: false,
  store: createStore(),
  keyGenerator: (req) => req.ip,
  handler: createRateLimitHandler('burst')
});

// Export all rate limiting configurations
export {
  rateLimitConfigs,
  smartRateLimit,
  progressiveRateLimit,
  burstProtection,
  createRateLimitHandler
};

export default smartRateLimit;