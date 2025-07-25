import rateLimit from 'express-rate-limit';
import { body, validationResult } from 'express-validator';
import AppError from '../utils/AppError.js';
import logger from '../utils/logger.js';

/**
 * Enhanced rate limiting configurations for different endpoints
 */
export const createRateLimiter = (options = {}) => {
  const defaultOptions = {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: {
      status: 'error',
      message: 'Too many requests from this IP, please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    // Custom key generator to include user ID if available
    keyGenerator: (req) => {
      return req.user?.id || req.ip;
    },
    // Skip successful requests in some cases
    skipSuccessfulRequests: options.skipSuccessfulRequests || false,
    // Custom handler for rate limit exceeded
    handler: (req, res) => {
      logger.warn('Rate limit exceeded', {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        path: req.path,
        userId: req.user?.id
      });
      res.status(429).json({
        status: 'error',
        message: options.message || 'Too many requests from this IP, please try again later.'
      });
    }
  };

  return rateLimit({ ...defaultOptions, ...options });
};

// Specific rate limiters for different endpoints
export const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per 15 minutes
  message: 'Too many authentication attempts, please try again in 15 minutes.',
  skipSuccessfulRequests: true
});

export const passwordResetLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 password reset requests per hour
  message: 'Too many password reset requests, please try again in an hour.'
});

export const emailVerificationLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 verification emails per hour
  message: 'Too many verification email requests, please try again in an hour.'
});

export const uploadLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50, // 50 uploads per hour
  message: 'Upload limit exceeded, please try again in an hour.'
});

export const apiLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // 1000 requests per 15 minutes (more generous for general API)
  message: 'API rate limit exceeded, please try again later.'
});

export const strictLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 requests per 15 minutes for sensitive operations
  message: 'Rate limit exceeded for sensitive operation, please try again later.'
});

/**
 * Advanced input sanitization middleware
 */
export const sanitizeInput = (req, res, next) => {
  // Remove null bytes and control characters
  const sanitizeString = (str) => {
    if (typeof str !== 'string') return str;
    return str.replace(/[\x00-\x1F\x7F]/g, '').trim();
  };

  // Recursively sanitize object
  const sanitizeObject = (obj) => {
    if (obj === null || typeof obj !== 'object') return obj;
    
    if (Array.isArray(obj)) {
      return obj.map(sanitizeObject);
    }
    
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      const cleanKey = sanitizeString(key);
      if (cleanKey && !['__proto__', 'constructor', 'prototype'].includes(cleanKey)) {
        sanitized[cleanKey] = typeof value === 'string' ? sanitizeString(value) : sanitizeObject(value);
      }
    }
    return sanitized;
  };

  // Sanitize request body
  if (req.body) {
    req.body = sanitizeObject(req.body);
  }

  // Sanitize query parameters
  if (req.query) {
    req.query = sanitizeObject(req.query);
  }

  next();
};

/**
 * Validate request and handle errors securely
 */
export const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const errorMessages = errors.array().map(error => error.msg);
    logger.warn('Validation failed:', { 
      errors: errorMessages, 
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      path: req.path 
    });
    return next(new AppError(`Validation failed: ${errorMessages.join(', ')}`, 400));
  }
  next();
};

/**
 * Detect and prevent potential attacks
 */
export const detectSuspiciousActivity = (req, res, next) => {
  const suspiciousPatterns = [
    /(<script|javascript:|vbscript:|onload=|onerror=)/i, // XSS patterns
    /(union\s+select|drop\s+table|insert\s+into)/i, // SQL injection patterns
    /(\$ne|\$gt|\$lt|\$regex)/i, // NoSQL injection patterns
    /(\.\.\/|\.\.\\|\/etc\/passwd|\/proc\/)/i, // Path traversal
  ];

  const checkString = (str) => {
    return suspiciousPatterns.some(pattern => pattern.test(str));
  };

  const checkObject = (obj) => {
    if (typeof obj === 'string') return checkString(obj);
    if (Array.isArray(obj)) return obj.some(checkObject);
    if (obj && typeof obj === 'object') {
      return Object.values(obj).some(checkObject);
    }
    return false;
  };

  // Check request body, query, and params
  const suspicious = checkObject(req.body) || checkObject(req.query) || checkObject(req.params);

  if (suspicious) {
    logger.error('Suspicious activity detected:', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      path: req.path,
      method: req.method,
      body: req.body,
      query: req.query,
      params: req.params
    });
    return next(new AppError('Request blocked due to suspicious content', 400));
  }

  next();
};