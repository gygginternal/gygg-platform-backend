import rateLimit from 'express-rate-limit';

// Strict rate limiting for password reset attempts
export const passwordResetLimiter = rateLimit({
  max: 3, // Only 3 attempts per hour
  windowMs: 60 * 60 * 1000, // 1 hour
  message: {
    error: 'Too many password reset attempts. Please try again after 1 hour.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiting for email verification requests
export const emailVerificationLimiter = rateLimit({
  max: 3, // Only 3 verification emails per hour
  windowMs: 60 * 60 * 1000, // 1 hour
  message: {
    error: 'Too many email verification requests. Please try again after 1 hour.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiting for chat message sending
export const chatMessageLimiter = rateLimit({
  max: 100, // 100 messages per 15 minutes
  windowMs: 15 * 60 * 1000, // 15 minutes
  message: {
    error: 'Too many messages sent. Please slow down.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiting for file uploads
export const fileUploadLimiter = rateLimit({
  max: 10, // 10 uploads per hour
  windowMs: 60 * 60 * 1000, // 1 hour
  message: {
    error: 'Too many file uploads. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});