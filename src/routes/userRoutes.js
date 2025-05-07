import express from 'express';
import { body, param, query } from 'express-validator';
import validateRequest from '../middleware/validateRequest.js';
import {
  signup,
  login,
  protect,
  restrictTo,
  updatePassword,
  logout,
} from '../controllers/authController.js';
import {
  getMe,
  updateMe,
  deleteMe,
  getAllUsers,
  getUser,
  updateUser,
  deleteUser,
  matchTaskers,
} from '../controllers/userController.js';
import {
  createStripeAccount,
  createStripeAccountLink,
  getStripeAccountStatus,
} from '../controllers/paymentController.js';

const router = express.Router();

/**
 * ===============================
 *        AUTHENTICATION ROUTES
 * ===============================
 */

// Sign up new users
router.post(
  '/signup',
  [
    body('firstName').notEmpty().withMessage('First name is required').trim().escape(),
    body('lastName').notEmpty().withMessage('Last name is required').trim().escape(),
    body('email').isEmail().withMessage('Please provide a valid email').normalizeEmail(),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('passwordConfirm')
            .notEmpty().withMessage('Please confirm your password')
            .custom((value, { req }) => { // Custom validator
                if (value !== req.body.password) {
                    throw new Error('Password confirmation does not match password');
                }
                // Indicates the success of this synchronous custom validator
                return true;
            }),
    body('role').optional().isArray().withMessage('Role must be an array'),
    body('role.*').isIn(['tasker', 'provider']).withMessage('Invalid role specified'),
    body('phoneNo')
      .optional({ checkFalsy: true })
      .isMobilePhone('any')
      .withMessage('Invalid phone number format'),
  ],
  validateRequest,
  signup
);

// Log in existing users
router.post(
  '/login',
  [
    body('email').isEmail().withMessage('Please provide a valid email').normalizeEmail(),
    body('password').notEmpty().withMessage('Password cannot be empty'),
  ],
  validateRequest,
  login
);

// Log out current user
router.get('/logout', logout);

/**
 * ===============================
 *      PASSWORD MANAGEMENT
 * ===============================
 */

// Protect all routes below - only accessible to logged-in users
router.use(protect);

// Allow users to update their password
router.patch(
  '/updateMyPassword',
  [
    body('passwordCurrent').notEmpty().withMessage('Current password is required'),
    body('password').isLength({ min: 8 }).withMessage('New password must be at least 8 characters'),
  ],
  validateRequest,
  updatePassword
);

/**
 * ===============================
 *         USER PROFILE ROUTES
 * ===============================
 */

// Get logged-in user's profile
router.get('/me', getMe, getUser);

// Update profile info for current user
router.patch(
  '/updateMe',
  [
    body('firstName').optional().trim().escape(),
    body('lastName').optional().trim().escape(),
    body('email').optional().isEmail().normalizeEmail(),
    body('phoneNo')
      .optional({ checkFalsy: true })
      .isMobilePhone('any')
      .withMessage('Invalid phone number format'),
    body('bio').optional().trim().escape().isLength({ max: 500 }),
    body('hobbies').optional().isArray(),
    body('hobbies.*').optional().isString().trim().escape(),
    body('peoplePreference').optional().trim().escape().isLength({ max: 300 }),
    body('availability').optional().isObject(),
    body('ratePerHour').optional().isNumeric().toFloat({ min: 0.0 }),
    body('address.street').optional().trim().escape(),
    body('address.city').optional().trim().escape(),
    body('address.state').optional().trim().escape(),
    body('address.postalCode').optional().trim().escape(),
    body('address.country').optional().trim().escape(),
    body('password').not().exists().withMessage('Password updates not allowed here.'),
  ],
  validateRequest,
  updateMe
);

// Delete current user's account
router.delete('/deleteMe', deleteMe);

/**
 * ===============================
 *      STRIPE ONBOARDING ROUTES
 * ===============================
 * Restricted to users with the 'tasker' role
 */

// Create a Stripe account (Tasker onboarding)
router.post('/stripe/create-account', restrictTo('tasker'), createStripeAccount);

// Create Stripe onboarding link for user to finish setup
router.get('/stripe/create-account-link', restrictTo('tasker'), createStripeAccountLink);

// Get current Stripe account status
router.get('/stripe/account-status', restrictTo('tasker'), getStripeAccountStatus);

/**
 * ===============================
 *        TASKER MATCHING ROUTE
 * ===============================
 * Restricted to users with the 'provider' role
 */

// Match taskers to a provider's request (e.g., based on location, skills, etc.)
router.get(
  '/match-taskers',
  [
    restrictTo('provider'),
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  ],
  validateRequest,
  matchTaskers
);

/**
 * ===============================
 *            ADMIN ROUTES
 * ===============================
 * Only accessible to admin users
 */

// Restrict all routes below to admin users only
router.use(restrictTo('admin'));

// Get a list of all users
router.get('/', getAllUsers);

// Admin CRUD operations for individual users
router
  .route('/:id')
  .get(
    param('id').isMongoId().withMessage('Invalid user ID format'),
    validateRequest,
    getUser
  )
  .patch(
    param('id').isMongoId().withMessage('Invalid user ID format'),
    [
      body('email').optional().isEmail().normalizeEmail(),
      body('role').optional().isArray(),
      body('role.*').isIn(['tasker', 'provider', 'admin']),
      body('active').optional().isBoolean().toBoolean(),
      body('password').not().exists().withMessage('Password updates not allowed via this route.'),
    ],
    validateRequest,
    updateUser
  )
  .delete(
    param('id').isMongoId().withMessage('Invalid user ID format'),
    validateRequest,
    deleteUser
  );

export default router;
