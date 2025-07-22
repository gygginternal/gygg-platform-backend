import { body, param, query } from 'express-validator';
import mongoose from 'mongoose';

/**
 * Common validation rules
 */
export const commonValidations = {
  mongoId: (field = 'id') => 
    param(field).isMongoId().withMessage(`Invalid ${field} format`),
  
  email: (field = 'email') =>
    body(field).isEmail().withMessage('Please provide a valid email').normalizeEmail(),
  
  password: (field = 'password') =>
    body(field)
      .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>])/)
      .withMessage('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'),
  
  phoneNumber: (field = 'phoneNo') =>
    body(field)
      .matches(/^\+\d{8,15}$/)
      .withMessage('Phone number must be in international E.164 format (e.g., +14165551234)'),
  
  pagination: () => [
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt()
  ],
  
  requiredString: (field, maxLength = null) => {
    const validation = body(field).notEmpty().withMessage(`${field} is required`).trim();
    if (maxLength) {
      validation.isLength({ max: maxLength }).withMessage(`${field} cannot exceed ${maxLength} characters`);
    }
    return validation;
  },
  
  optionalString: (field, maxLength = null) => {
    const validation = body(field).optional().trim();
    if (maxLength) {
      validation.isLength({ max: maxLength }).withMessage(`${field} cannot exceed ${maxLength} characters`);
    }
    return validation;
  },
  
  dateOfBirth: (field = 'dateOfBirth') =>
    body(field)
      .notEmpty().withMessage('Date of birth is required')
      .isISO8601().toDate().withMessage('Invalid date format. Use YYYY-MM-DD')
      .custom((value) => {
        const today = new Date();
        const birthDate = new Date(value);
        let age = today.getFullYear() - birthDate.getFullYear();
        const m = today.getMonth() - birthDate.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
          age--;
        }
        if (age < 18) {
          throw new Error('User must be at least 18 years old');
        }
        return true;
      }),
  
  role: (field = 'role') =>
    body(field)
      .optional()
      .isArray().withMessage('Role must be an array')
      .custom((roles) => {
        const validRoles = ['tasker', 'provider', 'admin'];
        const invalidRoles = roles.filter(role => !validRoles.includes(role));
        if (invalidRoles.length > 0) {
          throw new Error(`Invalid roles: ${invalidRoles.join(', ')}`);
        }
        return true;
      })
};

/**
 * Create validation middleware for specific entities
 */
export const createEntityValidation = {
  user: {
    create: [
      commonValidations.email(),
      commonValidations.password(),
      body('passwordConfirm')
        .notEmpty().withMessage('Please confirm your password')
        .custom((value, { req }) => {
          if (value !== req.body.password) {
            throw new Error('Passwords do not match');
          }
          return true;
        }),
      commonValidations.phoneNumber(),
      commonValidations.dateOfBirth(),
      commonValidations.role()
    ],
    
    update: [
      commonValidations.optionalString('firstName', 50),
      commonValidations.optionalString('lastName', 50),
      commonValidations.optionalString('bio', 750),
      body('phoneNo').optional().matches(/^\+\d{8,15}$/).withMessage('Invalid phone format'),
      body('ratePerHour').optional().isNumeric().toFloat({ min: 0.0 }),
      body('password').not().exists().withMessage('Password updates not allowed here')
    ],
    
    updatePassword: [
      body('passwordCurrent').notEmpty().withMessage('Current password is required'),
      commonValidations.password('password'),
      body('passwordConfirm').custom((value, { req }) => {
        if (value !== req.body.password) {
          throw new Error('New passwords do not match');
        }
        return true;
      })
    ]
  },
  
  auth: {
    login: [
      commonValidations.email(),
      body('password').notEmpty().withMessage('Password required')
    ],
    
    forgotPassword: [
      commonValidations.email()
    ],
    
    resetPassword: [
      param('token').notEmpty().withMessage('Token is required'),
      commonValidations.password(),
      body('passwordConfirm').custom((value, { req }) => {
        if (value !== req.body.password) {
          throw new Error('Passwords do not match');
        }
        return true;
      })
    ]
  }
};

/**
 * Custom validator to check if value is a valid MongoDB ObjectId
 */
export const isValidObjectId = (value) => {
  return mongoose.Types.ObjectId.isValid(value);
};

/**
 * Sanitize and validate array fields
 */
export const sanitizeArrayField = (value) => {
  if (typeof value === 'string') {
    return value.split(',').map(item => item.trim()).filter(item => item);
  }
  if (Array.isArray(value)) {
    return value.map(item => String(item).trim()).filter(item => item);
  }
  return [];
};

/**
 * Validate and parse JSON fields from form data
 */
export const parseJsonField = (value, fieldName) => {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed;
      }
      throw new Error(`${fieldName} must be a valid JSON object`);
    } catch (e) {
      throw new Error(`Invalid JSON format for ${fieldName}`);
    }
  }
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value;
  }
  throw new Error(`${fieldName} must be an object`);
};