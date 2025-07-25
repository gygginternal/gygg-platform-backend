import winston from 'winston';
import path from 'path';

// Create logs directory if it doesn't exist
const logsDir = path.join(process.cwd(), 'logs');

// Security-focused logger configuration
const securityLogger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      return JSON.stringify({
        timestamp,
        level,
        message,
        ...meta,
        environment: process.env.NODE_ENV,
        service: 'backend-api'
      });
    })
  ),
  defaultMeta: { service: 'security' },
  transports: [
    // Error logs
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    // Security-specific logs
    new winston.transports.File({
      filename: path.join(logsDir, 'security.log'),
      level: 'warn',
      maxsize: 5242880, // 5MB
      maxFiles: 10,
    }),
    // All logs
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    })
  ]
});

// Add console transport for development
if (process.env.NODE_ENV !== 'production') {
  securityLogger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }));
}

// Security event types
const SECURITY_EVENTS = {
  AUTH_SUCCESS: 'AUTH_SUCCESS',
  AUTH_FAILURE: 'AUTH_FAILURE',
  AUTH_BLOCKED: 'AUTH_BLOCKED',
  PAYMENT_CREATED: 'PAYMENT_CREATED',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  PAYMENT_REFUNDED: 'PAYMENT_REFUNDED',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  SUSPICIOUS_ACTIVITY: 'SUSPICIOUS_ACTIVITY',
  DATA_ACCESS: 'DATA_ACCESS',
  ADMIN_ACTION: 'ADMIN_ACTION',
  WEBHOOK_RECEIVED: 'WEBHOOK_RECEIVED',
  WEBHOOK_FAILED: 'WEBHOOK_FAILED'
};

// Security logging functions
const logSecurityEvent = (eventType, details = {}) => {
  const logData = {
    eventType,
    timestamp: new Date().toISOString(),
    ...details
  };

  // Remove sensitive data
  const sanitizedData = sanitizeLogData(logData);
  
  securityLogger.warn('Security Event', sanitizedData);
};

const logAuthAttempt = (email, success, ip, userAgent, reason = null) => {
  logSecurityEvent(success ? SECURITY_EVENTS.AUTH_SUCCESS : SECURITY_EVENTS.AUTH_FAILURE, {
    email: email ? email.substring(0, 3) + '***' : 'unknown', // Partially mask email
    success,
    ip,
    userAgent,
    reason
  });
};

const logPaymentEvent = (eventType, paymentId, userId, amount, details = {}) => {
  logSecurityEvent(eventType, {
    paymentId,
    userId,
    amount: amount ? `$${(amount / 100).toFixed(2)}` : null,
    ...details
  });
};

const logSuspiciousActivity = (userId, activity, details = {}) => {
  logSecurityEvent(SECURITY_EVENTS.SUSPICIOUS_ACTIVITY, {
    userId,
    activity,
    ...details
  });
};

const logDataAccess = (userId, resource, action, details = {}) => {
  logSecurityEvent(SECURITY_EVENTS.DATA_ACCESS, {
    userId,
    resource,
    action,
    ...details
  });
};

const logAdminAction = (adminId, action, targetId, details = {}) => {
  logSecurityEvent(SECURITY_EVENTS.ADMIN_ACTION, {
    adminId,
    action,
    targetId,
    ...details
  });
};

const logWebhookEvent = (eventType, success, details = {}) => {
  logSecurityEvent(success ? SECURITY_EVENTS.WEBHOOK_RECEIVED : SECURITY_EVENTS.WEBHOOK_FAILED, {
    webhookType: eventType,
    success,
    ...details
  });
};

// Sanitize sensitive data from logs
const sanitizeLogData = (data) => {
  const sensitiveFields = [
    'password', 'token', 'secret', 'key', 'authorization',
    'stripeSecretKey', 'jwtSecret', 'email', 'phone', 'ssn',
    'creditCard', 'bankAccount', 'stripePaymentIntentSecret'
  ];

  const sanitized = { ...data };
  
  const sanitizeObject = (obj) => {
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        const lowerKey = key.toLowerCase();
        
        if (sensitiveFields.some(field => lowerKey.includes(field))) {
          obj[key] = '[REDACTED]';
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
          sanitizeObject(obj[key]);
        }
      }
    }
  };

  sanitizeObject(sanitized);
  return sanitized;
};

// Error logging with context
const logError = (error, context = {}) => {
  securityLogger.error('Application Error', {
    message: error.message,
    stack: error.stack,
    ...sanitizeLogData(context)
  });
};

// Performance logging
const logPerformance = (operation, duration, details = {}) => {
  if (duration > 1000) { // Log slow operations (>1s)
    securityLogger.warn('Slow Operation', {
      operation,
      duration: `${duration}ms`,
      ...details
    });
  }
};

export {
  securityLogger,
  SECURITY_EVENTS,
  logSecurityEvent,
  logAuthAttempt,
  logPaymentEvent,
  logSuspiciousActivity,
  logDataAccess,
  logAdminAction,
  logWebhookEvent,
  logError,
  logPerformance,
  sanitizeLogData
};

export default securityLogger;