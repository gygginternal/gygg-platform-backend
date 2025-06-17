import express from 'express';
import { body, param, query } from 'express-validator';
import validateRequest from '../middleware/validateRequest.js';
import { parseJsonFields } from '../middleware/parseFormData.js'; // <<< IMPORT PARSER (assuming this middleware exists)

// --- AUTH CONTROLLER FUNCTIONS ---
import {
  signup, login, protect, restrictTo, updatePassword, logout,
  verifyEmail, resendVerificationEmail,
//   forgotPassword, resetPassword // <<< Added Forgot/Reset
} from '../controllers/authController.js';

// --- USER CONTROLLER FUNCTIONS ---
import {
  getMe, updateMe, deleteMe,
  getAllUsers, getUser, updateUser, deleteUser,
  matchTaskers,
  uploadAlbumPhoto, getUserAlbum, deleteAlbumPhoto,
  topMatchTaskersForProvider,
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

// --- PUBLIC PROFILE ROUTE (must be before any /:id or similar catch-all routes) ---
router.get('/public/:userId', [
  protect,
  param('userId').isMongoId().withMessage('Invalid user ID format'),
  validateRequest,
], getPublicProfile);

/**
 * ===============================
 *        PUBLIC AUTH & VERIFICATION ROUTES
 * ===============================
 */
const signupValidation = [
    // body('firstName').notEmpty().withMessage('First name is required').trim().escape(),
    // body('lastName').notEmpty().withMessage('Last name is required').trim().escape(),
    body('email').isEmail().withMessage('Please provide a valid email').normalizeEmail(),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('passwordConfirm').notEmpty().withMessage('Please confirm your password')
        .custom((value, { req }) => { if (value !== req.body.password) throw new Error('Passwords do not match'); return true; }),
    body('role').optional().isArray().withMessage('Role must be an array'),
    body('role.*').isIn(['tasker', 'provider']).withMessage('Invalid role specified'),
    
    // *** PHONE NUMBER VALIDATION - E.164 international format ***
    body('phoneNo')
      .notEmpty().withMessage('Phone number is required')
      .matches(/^\+\d{8,15}$/)
      .withMessage('Phone number must be in international E.164 format (e.g., +14165551234, +919876543210, +441234567890).'),

    body('dateOfBirth').notEmpty().withMessage('Date of Birth is required').isISO8601().toDate().withMessage('Invalid date of birth. Use YYYY-MM-DD.'),
];
router.post('/signup', signupValidation, validateRequest, signup);

const loginValidation = [
    body('email').isEmail().withMessage('Valid email required').normalizeEmail(),
    body('password').notEmpty().withMessage('Password required'),
];
router.post('/login', loginValidation, validateRequest, login);

router.get('/verifyEmail/:token', verifyEmail); // Token validated by controller

// --- Forgot/Reset Password Routes ---
// router.post('/forgotPassword', [
//     body('email').isEmail().withMessage('Please provide a valid email.').normalizeEmail(),
// ], validateRequest, forgotPassword);

// router.patch('/resetPassword/:token', [
//     param('token').notEmpty().withMessage('Token is required.'), // Token from URL
//     body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters.'),
//     body('passwordConfirm').custom((value, { req }) => { if (value !== req.body.password) throw new Error('New passwords do not match.'); return true; }),
// ], validateRequest, resetPassword);


/**
 * ===============================
 *      PROTECTED ROUTES START HERE
 * ===============================
 */
router.use(protect); // All routes below require authentication

router.get('/logout', logout); // Now protected
router.post('/resendVerificationEmail', resendVerificationEmail);

const updatePasswordValidation = [
    body('passwordCurrent').notEmpty().withMessage('Current password is required'),
    body('password').isLength({ min: 8 }).withMessage('New password min 8 chars'),
    body('passwordConfirm').custom((value, { req }) => { if (value !== req.body.password) throw new Error('New passwords do not match'); return true; })
];
router.patch('/updateMyPassword', updatePasswordValidation, validateRequest, updatePassword);

router.get('/me', getMe, getUser); // getMe sets req.params.id for getUser

const updateMeValidation = [
    // Text fields
    body('firstName').optional().trim().escape(),
    body('lastName').optional().trim().escape(),
    // *** PHONE NUMBER VALIDATION - E.164 international format ***
    body('phoneNo')
      .optional({ checkFalsy: true })
      .matches(/^\+\d{8,15}$/)
      .withMessage('Phone number must be in international E.164 format (e.g., +14165551234, +919876543210, +441234567890).'),
      
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
    uploadS3.single('profileImage'), // Multer for profile image (field name 'profileImage')
    parseJsonFields(['address', 'availability']), // <<< Parse stringified JSON fields from FormData
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
        uploadS3.single('albumImage'), // Multer for 'albumImage' field
        [ body('caption').trim().notEmpty().withMessage('Caption is required.').isLength({ max: 50 }).escape() ],
        validateRequest,
        uploadAlbumPhoto
    );

router.delete('/me/album/:photoId', [
    param('photoId').isMongoId().withMessage('Invalid photo ID format'),
], validateRequest, deleteAlbumPhoto);

// Route to view *another* user's public album
router.get('/users/:userId/album', [ // Changed path for clarity
    param('userId').isMongoId().withMessage('Invalid user ID format for album view'),
], validateRequest, getUserAlbum);

/**
 * ===============================
 *         TASKER MATCHING (Provider only)
 * ===============================
 */
const matchTaskersValidation = [
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
];
router.get('/match-taskers', restrictTo('provider'), matchTaskersValidation, validateRequest, matchTaskers);

// Provider: Get top matching taskers by hobbies and personality
router.get('/top-match-taskers', protect, restrictTo('provider'), topMatchTaskersForProvider);

/**
 * ===============================
 *         STRIPE ONBOARDING & DASHBOARD (Tasker only)
 * ===============================
 */
router.post('/stripe/connect-account', restrictTo('tasker'), createStripeAccount);
router.get('/stripe/account-link', restrictTo('tasker'), createStripeAccountLink);
router.get('/stripe/account-status', restrictTo('tasker'), getStripeAccountStatus);
// router.get('/stripe/dashboard-link', restrictTo('tasker'), getStripeLoginLink); // <<< Added route for Stripe Express Dashboard


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