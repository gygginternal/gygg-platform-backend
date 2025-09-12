/**
 * @swagger
 * components:
 *   schemas:
 *     UserSignup:
 *       type: object
 *       required:
 *         - email
 *         - password
 *         - passwordConfirm
 *         - phoneNo
 *         - dateOfBirth
 *       properties:
 *         firstName:
 *           type: string
 *           maxLength: 50
 *         lastName:
 *           type: string
 *           maxLength: 50
 *         email:
 *           type: string
 *           format: email
 *         password:
 *           type: string
 *           minLength: 8
 *           pattern: '^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>])'
 *         passwordConfirm:
 *           type: string
 *         phoneNo:
 *           type: string
 *           pattern: '^\+\d{8,15}$'
 *         dateOfBirth:
 *           type: string
 *           format: date
 *         role:
 *           type: array
 *           items:
 *             type: string
 *             enum: [tasker, provider]
 *     UserLogin:
 *       type: object
 *       required:
 *         - email
 *         - password
 *       properties:
 *         email:
 *           type: string
 *           format: email
 *         password:
 *           type: string
 *     UserUpdate:
 *       type: object
 *       properties:
 *         firstName:
 *           type: string
 *           maxLength: 50
 *         lastName:
 *           type: string
 *           maxLength: 50
 *         phoneNo:
 *           type: string
 *           pattern: '^\+\d{8,15}$'
 *         bio:
 *           type: string
 *           maxLength: 750
 *         hobbies:
 *           type: array
 *           items:
 *             type: string
 *         skills:
 *           type: array
 *           items:
 *             type: string
 *         ratePerHour:
 *           type: number
 *           minimum: 0
 */

import express from 'express';
import { body, param, query } from 'express-validator';
import validateRequest from '../middleware/validateRequest.js';
import { parseJsonFields } from '../middleware/parseFormData.js'; // <<< IMPORT PARSER (assuming this middleware exists)

// --- AUTH CONTROLLER FUNCTIONS ---
import {
  signup, login, protect, restrictTo, updatePassword, logout,
  verifyEmail, resendVerificationEmail,
  forgotPassword, resetPassword
} from '../controllers/authController.js';

// --- USER CONTROLLER FUNCTIONS ---
import {
  getMe, updateMe, deleteMe,
  getAllUsers, getUser, updateUser, deleteUser,
  matchTaskers,
  uploadAlbumPhoto, getUserAlbum, deleteAlbumPhoto,
  topMatchTaskersForProvider,
  searchTaskers,
  getPublicProfile
} from '../controllers/userController.js';

// --- PAYMENT CONTROLLER FUNCTIONS (for Stripe Onboarding) ---
import {
  createStripeAccount, createStripeAccountLink, getStripeAccountStatus,
//   getStripeLoginLink // <<< Added Stripe Login Link function
} from '../controllers/paymentController.js';

// --- S3 UPLOAD MIDDLEWARE ---
import { uploadS3 } from '../config/s3Config.js'; // Assuming this exists and is configured

const router = express.Router();

// --- PUBLIC PROFILE ROUTE (ABSOLUTE FIRST) ---
router.get('/public/:userId', [
  param('userId').isMongoId().withMessage('Invalid user ID format'),
  validateRequest,
  getPublicProfile
]);

// --- Logout Route (PUBLIC, FIRST) ---
router.post('/logout', logout);

/**
 * ===============================
 *        PUBLIC AUTH & VERIFICATION ROUTES
 * ===============================
 */
const signupValidation = [
    // body('firstName').notEmpty().withMessage('First name is required').trim().escape(),
    // body('lastName').notEmpty().withMessage('Last name is required').trim().escape(),
    body('email').isEmail().withMessage('Please provide a valid email').normalizeEmail(),
    body('password')
      .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>])/)
      .withMessage('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'),
    body('passwordConfirm').notEmpty().withMessage('Please confirm your password')
        .custom((value, { req }) => { if (value !== req.body.password) throw new Error('Passwords do not match'); return true; }),
    body('role').optional().isArray().withMessage('Role must be an array'),
    body('role.*').isIn(['tasker', 'provider']).withMessage('Invalid role specified'),
    
    // *** PHONE NUMBER VALIDATION - Simplified ***
    body('phoneNo')
      .notEmpty().withMessage('Phone number is required')
      .matches(/^\+1\d+$/)
      .withMessage('Phone number must start with +1'),

    body('dateOfBirth').notEmpty().withMessage('Date of Birth is required').isISO8601().toDate().withMessage('Invalid date of birth. Use YYYY-MM-DD.'),
];
/**
 * @swagger
 * /users/signup:
 *   post:
 *     summary: Register a new user
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UserSignup'
 *     responses:
 *       201:
 *         description: User created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: success
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       $ref: '#/components/schemas/User'
 *                 token:
 *                   type: string
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 */
router.post('/signup', signupValidation, validateRequest, signup);

const loginValidation = [
    body('email').isEmail().withMessage('Valid email required').normalizeEmail(),
    body('password').notEmpty().withMessage('Password required'),
];
/**
 * @swagger
 * /users/login:
 *   post:
 *     summary: Login user
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UserLogin'
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: success
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       $ref: '#/components/schemas/User'
 *                     token:
 *                       type: string
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.post('/login', loginValidation, validateRequest, login);

router.get('/verifyEmail/:token', verifyEmail); // Token validated by controller

// Debug route for development (remove in production)
if (process.env.NODE_ENV === 'development') {
  router.get('/debug/verification/:email', async (req, res) => {
    try {
      const User = (await import('../models/User.js')).default;
      const user = await User.findOne({ email: req.params.email });
      
      if (!user) {
        return res.json({ error: 'User not found' });
      }
      
      const rateLimitStatus = user.getEmailVerificationStatus();
      
      res.json({
        email: user.email,
        isEmailVerified: user.isEmailVerified,
        hasToken: !!user.emailVerificationToken,
        tokenExpires: user.emailVerificationExpires ? new Date(user.emailVerificationExpires) : null,
        tokenExpired: user.emailVerificationExpires ? user.emailVerificationExpires <= Date.now() : null,
        rateLimit: rateLimitStatus
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Generate fresh verification link for testing
  router.post('/debug/generate-verification/:email', async (req, res) => {
    try {
      const User = (await import('../models/User.js')).default;
      const user = await User.findOne({ email: req.params.email });
      
      if (!user) {
        return res.json({ error: 'User not found' });
      }
      
      if (user.isEmailVerified) {
        return res.json({ error: 'User is already verified' });
      }
      
      try {
        const token = user.createEmailVerificationToken();
        await user.save({ validateBeforeSave: false });
        
        const frontendURL = process.env.ADDITIONAL_FRONTEND_URLS ? 
          process.env.ADDITIONAL_FRONTEND_URLS.split(',')[0].trim() : 
          "http://localhost:3000";
        const verificationURL = `${frontendURL}/verify-email?token=${token}`;
        
        res.json({
          success: true,
          email: user.email,
          token: token,
          verificationURL: verificationURL,
          expires: new Date(user.emailVerificationExpires),
          attempts: user.emailVerificationAttempts
        });
      } catch (error) {
        res.status(429).json({ error: error.message });
      }
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
}

// --- Forgot/Reset Password Routes ---
router.post('/forgotPassword', [
    body('email').isEmail().withMessage('Please provide a valid email.').normalizeEmail(),
], validateRequest, forgotPassword);

router.patch('/resetPassword/:token', [
    param('token').notEmpty().withMessage('Token is required.'), // Token from URL
    body('password')
      .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>])/)
      .withMessage('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'),
    body('passwordConfirm').custom((value, { req }) => { if (value !== req.body.password) throw new Error('New passwords do not match.'); return true; }),
], validateRequest, resetPassword);

/**
 * ===============================
 *      PROTECTED ROUTES START HERE
 * ===============================
 */
router.post('/resendVerificationEmail', resendVerificationEmail);
router.use(protect); // All routes below require authentication

/**
 * ===============================
 *         STRIPE ONBOARDING & DASHBOARD (Tasker only)
 * ===============================
 */
router.post('/stripe/connect-account', restrictTo('tasker', 'provider'), createStripeAccount);
router.get('/stripe/account-link', restrictTo('tasker', 'provider'), createStripeAccountLink);
router.get('/stripe/account-status', restrictTo('tasker', 'provider'), getStripeAccountStatus);
// router.get('/stripe/dashboard-link', restrictTo('tasker'), getStripeLoginLink); // <<< Added route for Stripe Express Dashboard

const updatePasswordValidation = [
    body('passwordCurrent').notEmpty().withMessage('Current password is required'),
    body('password')
      .isLength({ min: 8 }).withMessage('New password must be at least 8 characters')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>])/)
      .withMessage('New password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'),
    body('passwordConfirm').custom((value, { req }) => { if (value !== req.body.password) throw new Error('New passwords do not match'); return true; })
];
router.patch('/updateMyPassword', updatePasswordValidation, validateRequest, updatePassword);

/**
 * @swagger
 * /users/me:
 *   get:
 *     summary: Get current user profile
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: User profile retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: success
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       $ref: '#/components/schemas/User'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.get('/me', getMe, getUser); // getMe sets req.params.id for getUser

const updateMeValidation = [
    // Text fields
    body('firstName').optional().trim().escape(),
    body('lastName').optional().trim().escape(),
    // *** PHONE NUMBER VALIDATION - Simplified ***
    body('phoneNo')
      .optional({ checkFalsy: true })
      .matches(/^\+1\d+$/)
      .withMessage('Phone number must start with +1'),
      
    body('bio').optional().trim().escape().isLength({ max: 750 }).withMessage('Bio cannot exceed 750 characters'),
    // Arrays (controller handles string to array conversion if needed from FormData)
    body('hobbies').optional(),
    body('skills').optional(),
    body('peoplePreference').optional(), // Frontend might send as array or string
    // Objects (sent as JSON strings in FormData, parsed by middleware)
    body('availability').optional().isObject().withMessage('Availability must be a valid object after parsing.'),
    body('address').optional().isObject().withMessage('Address must be a valid object after parsing.'),
    // Nested address field validation (runs AFTER parseJsonFields middleware)
    body('address.street').optional({ checkFalsy: true }).trim().escape(),
    body('address.city').optional({ checkFalsy: true }).trim().escape(),
    body('address.state').optional({ checkFalsy: true }).trim().escape(),
    body('address.postalCode').optional({ checkFalsy: true }).trim().escape(),
    body('address.country').optional({ checkFalsy: true }).trim().escape(),

    body('ratePerHour').optional().isNumeric().toFloat({ min: 0.0 }),
    body('dateOfBirth').optional({ checkFalsy: true }).isISO8601().toDate().withMessage('Invalid date of birth. Use YYYY-MM-DD.'),
    body('isTaskerOnboardingComplete').optional().isBoolean().toBoolean(),
    body('isProviderOnboardingComplete').optional().isBoolean().toBoolean(),
    body('password').not().exists().withMessage('Password updates not allowed here.'),
];
router.patch('/updateMe',
    uploadS3.single('profileImage'),
    parseJsonFields(['address', 'availability']),
    updateMeValidation,
    validateRequest,
    updateMe
);

router.delete('/deleteMe', deleteMe);

/**
 * ===============================
 *         USER ALBUM (Protected, relative to /me)
 * ===============================
 */
router.route('/me/album')
    .get(getUserAlbum)
    .post(
        uploadS3.single('albumImage'),
        [ body('caption').trim().notEmpty().withMessage('Caption is required.').isLength({ max: 50 }).escape() ],
        validateRequest,
        uploadAlbumPhoto
    );

router.delete('/me/album/:photoId', [
    param('photoId').isMongoId().withMessage('Invalid photo ID format'),
], validateRequest, deleteAlbumPhoto);

/**
 * ===============================
 *         TASKER MATCHING (Provider only)
 * ===============================
 */
const matchTaskersValidation = [
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
    query('search').optional().isString().trim().isLength({ min: 1, max: 100 }),
];
router.get('/match-taskers', protect, restrictTo('provider'), matchTaskersValidation, validateRequest, matchTaskers);

// Provider: Get top matching taskers by hobbies and personality
const topMatchTaskersValidation = [
    query('search').optional().isString().trim().isLength({ min: 1, max: 100 }),
];
router.get('/top-match-taskers', protect, restrictTo('provider'), topMatchTaskersValidation, validateRequest, topMatchTaskersForProvider);

// Public: Search taskers (available to all authenticated users)
const searchTaskersValidation = [
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
    query('search').optional().isString().trim().isLength({ min: 1, max: 100 }),
];
router.get('/search-taskers', protect, searchTaskersValidation, validateRequest, searchTaskers);

/**
 * ===============================
 *         ALBUM VIEWING (Protected, not admin-only)
 * ===============================
 */
// Route to view another user's album (requires authentication, not admin-only)
// This route is placed before admin restrictions to avoid conflicts
router.get('/:userId/album', [
  param('userId').isMongoId().withMessage('Invalid user ID format for album view'),
  validateRequest,
  getUserAlbum
]);

/**
 * ===============================
 *         ADMIN OPERATIONS
 * ===============================
 */
router.use(restrictTo('admin')); // All routes below are admin-only

const adminGetAllUsersValidation = [
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    // Add query validation for other admin filters like role, active status
];
router.get('/', adminGetAllUsersValidation, validateRequest, getAllUsers); // GET /api/v1/users (admin)

const adminUserByIdParamValidation = [ param('id').isMongoId().withMessage('Invalid user ID format') ];
const adminUpdateUserBodyValidation = [
    body('firstName').optional().trim().escape(),
    body('lastName').optional().trim().escape(),
    body('email').optional().isEmail().normalizeEmail(),
    body('role').optional().isArray(), body('role.*').isIn(['tasker', 'provider', 'admin']),
    body('active').optional().isBoolean().toBoolean(),
    body('isEmailVerified').optional().isBoolean().toBoolean(),
    body('isTaskerOnboardingComplete').optional().isBoolean().toBoolean(),
    body('isProviderOnboardingComplete').optional().isBoolean().toBoolean(),
    // If admin updates address/availability and they are sent as JSON strings
    body('address').optional().custom(value => { try { JSON.parse(value); return true; } catch (e) { return false; }}).withMessage('Address must be valid JSON if string'),
    body('availability').optional().custom(value => { try { JSON.parse(value); return true; } catch (e) { return false; }}).withMessage('Availability must be valid JSON if string'),
    // Admin should not update password here
    body('password').not().exists().withMessage('Admin password updates should use a dedicated mechanism.'),
];

router.route('/:id') // Base path for admin user operations: /api/v1/users/:id
    .get(adminUserByIdParamValidation, validateRequest, getUser)
    .patch(
        adminUserByIdParamValidation,
        uploadS3.single('profileImage'), // Admin can also update profile image
        parseJsonFields(['address', 'availability']), // Parse if admin sends JSON strings
        adminUpdateUserBodyValidation,
        validateRequest,
        updateUser
    )
    .delete(adminUserByIdParamValidation, validateRequest, deleteUser);

export default router;