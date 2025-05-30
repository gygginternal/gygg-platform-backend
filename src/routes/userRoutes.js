// src/routes/userRoutes.js
import express from "express";
import { body, param, query } from "express-validator";
import validateRequest from "../middleware/validateRequest.js";

import {
  signup,
  login,
  protect,
  restrictTo,
  updatePassword,
  logout,
  verifyEmail,
  resendVerificationEmail,
} from "../controllers/authController.js";

// Ensure ALL needed functions are imported from userController
import {
  getMe,
  updateMe,
  deleteMe,
  getAllUsers,
  getUser,
  updateUser,
  deleteUser, // Admin functions
  matchTaskers,
  uploadAlbumPhoto,
  getUserAlbum,
  deleteAlbumPhoto,
} from "../controllers/userController.js";

import {
  createStripeAccount,
  createStripeAccountLink,
  getStripeAccountStatus,
  createStripeLoginLink, // Import the new controller function
} from "../controllers/paymentController.js";

import { uploadS3 } from "../config/s3Config.js"; // S3 Upload middleware
import { parseJsonFields } from "../middleware/parseFormData.js";

const router = express.Router();

/**
 * ===============================
 *        AUTHENTICATION & VERIFICATION
 * ===============================
 */
const signupValidation = [
    body('firstName').notEmpty().withMessage('First name is required').trim().escape(),
    body('lastName').notEmpty().withMessage('Last name is required').trim().escape(),
    body('email').isEmail().withMessage('Please provide a valid email').normalizeEmail(),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('passwordConfirm').notEmpty().withMessage('Please confirm your password')
        .custom((value, { req }) => { if (value !== req.body.password) throw new Error('Passwords do not match'); return true; }),
    body('role').optional().isArray().withMessage('Role must be an array'),
    body('role.*').isIn(['tasker', 'provider']).withMessage('Invalid role specified'),
    body('phoneNo').optional({ checkFalsy: true }).isMobilePhone('any', { strictMode: false }).withMessage('Invalid phone number format'),
    body('dateOfBirth')
        // If DOB is required on signup:
        // .notEmpty().withMessage('Date of birth is required.')
        // If DOB is optional on signup:
        .optional({ checkFalsy: true })
        .isISO8601().toDate().withMessage('Invalid date of birth. Use YYYY-MM-DD.')
];
router.post('/signup', signupValidation, validateRequest, signup);

const loginValidation = [
    body('email').isEmail().withMessage('Valid email required').normalizeEmail(),
    body('password').notEmpty().withMessage('Password required'),
];
router.post('/login', loginValidation, validateRequest, login);

router.get('/logout', logout);
router.get('/verifyEmail/:token', verifyEmail);

/**
 * ===============================
 *      PASSWORD & PROFILE (Protected)
 * ===============================
 */
router.use(protect);

router.post('/resendVerificationEmail', resendVerificationEmail);

const updatePasswordValidation = [
    body('passwordCurrent').notEmpty().withMessage('Current password is required'),
    body('password').isLength({ min: 8 }).withMessage('New password min 8 chars'),
    body('passwordConfirm').custom((value, { req }) => { if (value !== req.body.password) throw new Error('New passwords do not match'); return true; })
];
router.patch('/updateMyPassword', updatePasswordValidation, validateRequest, updatePassword);

router.get('/me', getMe, getUser);

const updateMeValidation = [
    body('firstName').optional().trim().escape(),
    body('lastName').optional().trim().escape(),
    body('phoneNo').optional({ checkFalsy: true }).isMobilePhone('any', { strictMode: false }),
    body('bio').optional().trim().escape().isLength({ max: 750 }).withMessage('Bio cannot exceed 750 characters'), // Updated bio validation
    body('hobbies').optional(), // Allow string or array, controller will parse string
    body('skills').optional(),  // Allow string or array
    body('peoplePreference').optional(), // Allow string or array
    body('availability').optional().isJSON().withMessage('Availability must be a valid JSON string if provided.'), // If sending as JSON string from FormData
    body('ratePerHour').optional().isNumeric().toFloat({ min: 0.0 }),
    body('address').optional().isJSON().withMessage('Address must be a valid JSON string if provided.'), // If sending as JSON string
    body('dateOfBirth')
        .optional({ checkFalsy: true }) // Allows empty string or null to pass here, model validator handles logic if value exists
        .isISO8601()
        .toDate() // Converts valid ISO8601 string to Date object
        .withMessage('Invalid date of birth format. Please use YYYY-MM-DD.'),
    body('isTaskerOnboardingComplete').optional().isBoolean().toBoolean(),
    body('isProviderOnboardingComplete').optional().isBoolean().toBoolean(),
    body('password').not().exists().withMessage('Password updates not allowed here.'),
];
// For updateMe, Multer middleware for profileImage must come BEFORE body validators if file affects body
router.patch('/updateMe',
    uploadS3.single('profileImage'), // Field name for profile image
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

router.get('/:userId/album', [ // Viewing another user's album
    param('userId').isMongoId().withMessage('Invalid user ID format'),
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


/**
 * ===============================
 *         STRIPE ONBOARDING (Tasker only)
 * ===============================
 */
router.post('/stripe/connect-account', restrictTo('tasker'), createStripeAccount);
router.get('/stripe/account-link', restrictTo('tasker'), createStripeAccountLink);
router.get('/stripe/account-status', restrictTo('tasker'), getStripeAccountStatus);

/**
 * ===============================
 *         ADMIN OPERATIONS
 * ===============================
 */
router.use(restrictTo('admin'));

const adminGetAllUsersValidation = [
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
];
router.get('/', adminGetAllUsersValidation, validateRequest, getAllUsers);

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
    body('password').not().exists().withMessage('Admin password updates should use a dedicated mechanism.'),
    // Add other fields admin can modify like bio, address, etc. with their validations
];

router.route('/:id')
    .get(adminUserByIdParamValidation, validateRequest, getUser)
    .patch(
        adminUserByIdParamValidation,
        uploadS3.single('profileImage'), // Admin can also update profile image
        adminUpdateUserBodyValidation,
        validateRequest,
        updateUser
    )
    .delete(adminUserByIdParamValidation, validateRequest, deleteUser);

export default router;
