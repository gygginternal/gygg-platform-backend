import rateLimit from 'express-rate-limit';
import { body, validationResult } from 'express-validator';
import AppError from '../utils/AppError.js';
import logger from '../utils/logger.js';

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