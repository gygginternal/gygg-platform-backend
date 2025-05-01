import express from 'express';
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
} from '../controllers/userController.js';
import {
  createStripeAccount,
  createStripeAccountLink,
  getStripeAccountStatus,
} from '../controllers/paymentController.js'; // Stripe payment-related functions

const router = express.Router();

/**
 * --- Authentication Routes ---
 * These routes are used for user sign-up, login, and logout functionality.
 */

// User sign-up route
router.post('/signup', signup);

// User login route
router.post('/login', login);

// User logout route
router.get('/logout', logout);


/**
 * --- Password Management Routes ---
 * These routes allow users to update their passwords. More routes (e.g., forgot/reset) can be added later.
 */
router.use(protect); // Protect all routes below this middleware (user must be logged in)

// Update password route
router.patch('/updateMyPassword', updatePassword);


/**
 * --- User Profile Routes ---
 * These routes allow users to get and update their own profile information.
 */

// Get currently logged-in user's profile data
router.get('/me', getMe, getUser);

// Update currently logged-in user's profile data
router.patch('/updateMe', updateMe);

// Delete currently logged-in user's account
router.delete('/deleteMe', deleteMe);


/**
 * --- Stripe Onboarding Routes ---
 * These routes handle Stripe Connect account creation, account status checking, and account link creation.
 * Only users with the 'tasker' role are allowed to access these routes.
 */

// Route to create a Stripe Connect account for a tasker
router.post('/stripe/create-account', restrictTo('tasker'), createStripeAccount);

// Route to generate a Stripe account link for a tasker to complete the onboarding process
router.get('/stripe/create-account-link', restrictTo('tasker'), createStripeAccountLink);

// Route to get the status of a tasker's Stripe account
router.get('/stripe/account-status', restrictTo('tasker'), getStripeAccountStatus);


/**
 * --- Admin Routes ---
 * These routes allow an admin to manage all users in the system. These routes are protected by the 'admin' role.
 */
router.use(restrictTo('admin')); // Protect all routes below this middleware (user must have 'admin' role)

// Route to get all users
router.route('/').get(getAllUsers);

// Routes to get, update, and delete individual users by ID
router
  .route('/:id')
  .get(getUser)        // Get a specific user by ID
  .patch(updateUser)   // Admin can update a user's information (carefully defined fields)
  .delete(deleteUser); // Admin can delete a user's account

export default router;
