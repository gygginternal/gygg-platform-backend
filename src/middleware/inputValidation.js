import { body, param, query, validationResult } from 'express-validator';
import AppError from '../utils/AppError.js';
import { logSuspiciousActivity } from '../utils/securityLogger.js';
import rateLimit from 'express-rate-limit';

// Common validation patterns
const VALIDATION_PATTERNS = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  password: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/,
  phone: /^\+?[\d\s\-\(\)]{10,}$/,
  mongoId: /^[0-9a-fA-F]{24}$/,
  url: /^https?:\/\/.+/,
  alphanumeric: /^[a-zA-Z0-9\s]+$/,
  noScript: /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi
};

// Sanitization functions
const sanitizeInput = (value) => {
  if (typeof value !== 'string') return value;
  
  // Remove potential XSS
  value = value.replace(VALIDATION_PATTERNS.noScript, '');
  
  // Remove potential SQL injection patterns
  const sqlPatterns = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION|SCRIPT)\b)/gi,
    /(--|\/\*|\*\/|;|'|"|`)/g
  ];
  
  sqlPatterns.forEach(pattern => {
    value = value.replace(pattern, '');
  });
  
  // Trim and normalize
  return value.trim();
};

// Rate limiting for validation failures
const validationFailureLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 validation failures per windowMs
  message: 'Too many validation failures, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logSuspiciousActivity(req.user?.id || 'anonymous', 'excessive_validation_failures', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      url: req.originalUrl
    });
    
    res.status(429).json({
      status: 'error',
      message: 'Too many validation failures, please try again later'
    });
  }
});

// Validation result handler
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    // Log suspicious validation patterns
    const errorMessages = errors.array().map(err => err.msg);
    const suspiciousPatterns = [
      'script', 'javascript:', 'onload', 'onerror', 'eval(',
      'SELECT', 'INSERT', 'DELETE', 'DROP', 'UNION'
    ];
    
    const hasSuspiciousContent = errorMessages.some(msg => 
      suspiciousPatterns.some(pattern => 
        msg.toLowerCase().includes(pattern.toLowerCase())
      )
    );
    
    if (hasSuspiciousContent) {
      logSuspiciousActivity(req.user?.id || 'anonymous', 'malicious_input_attempt', {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        url: req.originalUrl,
        errors: errorMessages
      });
    }
    
    return next(new AppError('Invalid input data', 400, errors.array()));
  }
  
  next();
};

// Common validation rules
const commonValidations = {
  email: body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email')
    .customSanitizer(sanitizeInput),
    
  password: body('password')
    .isLength({ min: 8, max: 128 })
    .withMessage('Password must be between 8 and 128 characters')
    .matches(VALIDATION_PATTERNS.password)
    .withMessage('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'),
    
  name: (field) => body(field)
    .isLength({ min: 1, max: 50 })
    .withMessage(`${field} must be between 1 and 50 characters`)
    .matches(/^[a-zA-Z\s'-]+$/)
    .withMessage(`${field} can only contain letters, spaces, hyphens, and apostrophes`)
    .customSanitizer(sanitizeInput),
    
  mongoId: (field) => param(field)
    .matches(VALIDATION_PATTERNS.mongoId)
    .withMessage(`Invalid ${field} format`),
    
  pagination: [
    query('page')
      .optional()
      .isInt({ min: 1, max: 1000 })
      .withMessage('Page must be a positive integer less than 1000'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limit must be between 1 and 100')
  ],
  
  text: (field, maxLength = 1000) => body(field)
    .optional()
    .isLength({ max: maxLength })
    .withMessage(`${field} must not exceed ${maxLength} characters`)
    .customSanitizer(sanitizeInput),
    
  url: (field) => body(field)
    .optional()
    .matches(VALIDATION_PATTERNS.url)
    .withMessage(`${field} must be a valid URL`)
    .customSanitizer(sanitizeInput),
    
  phone: body('phone')
    .optional()
    .matches(VALIDATION_PATTERNS.phone)
    .withMessage('Please provide a valid phone number')
    .customSanitizer(sanitizeInput),
    
  amount: (field) => body(field)
    .isFloat({ min: 0.01, max: 100000 })
    .withMessage(`${field} must be between $0.01 and $100,000`)
    .toFloat(),
    
  rating: body('rating')
    .optional()
    .isFloat({ min: 1, max: 5 })
    .withMessage('Rating must be between 1 and 5')
    .toFloat(),
    
  array: (field, maxItems = 20) => body(field)
    .optional()
    .isArray({ max: maxItems })
    .withMessage(`${field} must be an array with maximum ${maxItems} items`),
    
  enum: (field, allowedValues) => body(field)
    .optional()
    .isIn(allowedValues)
    .withMessage(`${field} must be one of: ${allowedValues.join(', ')}`)
};

// Specific validation sets
const authValidation = {
  register: [
    commonValidations.email,
    commonValidations.password,
    commonValidations.name('firstName'),
    commonValidations.name('lastName'),
    body('role')
      .isIn(['provider', 'tasker'])
      .withMessage('Role must be either provider or tasker'),
    handleValidationErrors
  ],
  
  login: [
    commonValidations.email,
    body('password')
      .notEmpty()
      .withMessage('Password is required')
      .customSanitizer(sanitizeInput),
    handleValidationErrors
  ],
  
  forgotPassword: [
    commonValidations.email,
    handleValidationErrors
  ],
  
  resetPassword: [
    param('token')
      .isLength({ min: 32, max: 256 })
      .withMessage('Invalid reset token'),
    commonValidations.password,
    handleValidationErrors
  ]
};

const paymentValidation = {
  createPayment: [
    commonValidations.mongoId('contractId'),
    commonValidations.amount('amount'),
    body('currency')
      .isIn(['usd', 'cad', 'eur'])
      .withMessage('Currency must be USD, CAD, or EUR'),
    handleValidationErrors
  ],
  
  refundPayment: [
    commonValidations.mongoId('contractId'),
    body('reason')
      .optional()
      .isLength({ max: 500 })
      .withMessage('Reason must not exceed 500 characters')
      .customSanitizer(sanitizeInput),
    handleValidationErrors
  ]
};

const profileValidation = {
  updateProfile: [
    commonValidations.name('firstName'),
    commonValidations.name('lastName'),
    commonValidations.phone,
    commonValidations.text('bio', 2000),
    commonValidations.url('website'),
    commonValidations.array('skills', 50),
    commonValidations.array('hobbies', 30),
    body('hourlyRate')
      .optional()
      .isFloat({ min: 5, max: 1000 })
      .withMessage('Hourly rate must be between $5 and $1000')
      .toFloat(),
    handleValidationErrors
  ]
};

const gigValidation = {
  createGig: [
    body('title')
      .isLength({ min: 5, max: 100 })
      .withMessage('Title must be between 5 and 100 characters')
      .customSanitizer(sanitizeInput),
    body('description')
      .isLength({ min: 20, max: 5000 })
      .withMessage('Description must be between 20 and 5000 characters')
      .customSanitizer(sanitizeInput),
    commonValidations.amount('budget'),
    body('category')
      .isIn(['web-development', 'design', 'writing', 'marketing', 'data-entry', 'other'])
      .withMessage('Invalid category'),
    body('deadline')
      .isISO8601()
      .withMessage('Deadline must be a valid date')
      .custom((value) => {
        if (new Date(value) <= new Date()) {
          throw new Error('Deadline must be in the future');
        }
        return true;
      }),
    commonValidations.array('requiredSkills', 20),
    handleValidationErrors
  ]
};

// File upload validation
const fileValidation = {
  image: (field) => [
    body(field)
      .optional()
      .custom((value, { req }) => {
        if (!req.file) return true;
        
        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        const maxSize = 5 * 1024 * 1024; // 5MB
        
        if (!allowedTypes.includes(req.file.mimetype)) {
          throw new Error('Only JPEG, PNG, GIF, and WebP images are allowed');
        }
        
        if (req.file.size > maxSize) {
          throw new Error('Image size must be less than 5MB');
        }
        
        return true;
      }),
    handleValidationErrors
  ],
  
  document: (field) => [
    body(field)
      .optional()
      .custom((value, { req }) => {
        if (!req.file) return true;
        
        const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
        const maxSize = 10 * 1024 * 1024; // 10MB
        
        if (!allowedTypes.includes(req.file.mimetype)) {
          throw new Error('Only PDF and Word documents are allowed');
        }
        
        if (req.file.size > maxSize) {
          throw new Error('Document size must be less than 10MB');
        }
        
        return true;
      }),
    handleValidationErrors
  ]
};

export {
  validationFailureLimit,
  handleValidationErrors,
  commonValidations,
  authValidation,
  paymentValidation,
  profileValidation,
  gigValidation,
  fileValidation,
  sanitizeInput
};