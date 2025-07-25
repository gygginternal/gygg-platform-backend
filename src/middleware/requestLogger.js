import logger from '../utils/logger.js';
import crypto from 'crypto';

/**
 * Request logging middleware for security monitoring and debugging
 */
export const requestLogger = (req, res, next) => {
  // Generate unique request ID
  req.id = crypto.randomBytes(16).toString('hex');
  
  // Start time for performance monitoring
  req.startTime = Date.now();
  
  // Extract relevant request information
  const requestInfo = {
    requestId: req.id,
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    contentType: req.get('Content-Type'),
    contentLength: req.get('Content-Length'),
    timestamp: new Date().toISOString(),
    userId: req.user?.id,
    userEmail: req.user?.email
  };
  
  // Log request (exclude sensitive data)
  const sanitizedInfo = { ...requestInfo };
  
  // Don't log sensitive paths in detail
  if (req.path.includes('/login') || req.path.includes('/signup') || req.path.includes('/password')) {
    sanitizedInfo.body = '[REDACTED]';
  }
  
  logger.info('Incoming request', sanitizedInfo);
  
  // Capture response details
  const originalSend = res.send;
  res.send = function(data) {
    const responseTime = Date.now() - req.startTime;
    
    // Log response
    logger.info('Request completed', {
      requestId: req.id,
      statusCode: res.statusCode,
      responseTime: `${responseTime}ms`,
      contentLength: res.get('Content-Length'),
      userId: req.user?.id
    });
    
    // Log slow requests
    if (responseTime > 5000) {
      logger.warn('Slow request detected', {
        requestId: req.id,
        method: req.method,
        url: req.originalUrl,
        responseTime: `${responseTime}ms`,
        userId: req.user?.id
      });
    }
    
    // Call original send
    originalSend.call(this, data);
  };
  
  next();
};

/**
 * Security event logger for suspicious activities
 */
export const securityLogger = {
  logFailedAuth: (email, ip, userAgent, reason) => {
    logger.warn('Authentication failed', {
      event: 'AUTH_FAILED',
      email,
      ip,
      userAgent,
      reason,
      timestamp: new Date().toISOString()
    });
  },
  
  logSuspiciousActivity: (userId, activity, details) => {
    logger.error('Suspicious activity detected', {
      event: 'SUSPICIOUS_ACTIVITY',
      userId,
      activity,
      details,
      timestamp: new Date().toISOString()
    });
  },
  
  logPrivilegeEscalation: (userId, attemptedAction, currentRole) => {
    logger.error('Privilege escalation attempt', {
      event: 'PRIVILEGE_ESCALATION',
      userId,
      attemptedAction,
      currentRole,
      timestamp: new Date().toISOString()
    });
  },
  
  logDataAccess: (userId, resource, action) => {
    logger.info('Data access', {
      event: 'DATA_ACCESS',
      userId,
      resource,
      action,
      timestamp: new Date().toISOString()
    });
  },
  
  logSecurityEvent: (event, details) => {
    logger.warn('Security event', {
      event,
      details,
      timestamp: new Date().toISOString()
    });
  }
};