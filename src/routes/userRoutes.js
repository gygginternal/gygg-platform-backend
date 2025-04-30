import express from 'express';
import {
  signup,
  login,
  protect,
  restrictTo,
  updatePassword,
  logout,
  // forgotPassword, // Add later
  // resetPassword,  // Add later
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

const router = express.Router();

// --- Authentication Routes ---
router.post('/signup', signup);
router.post('/login', login);
router.get('/logout', logout); // GET or POST for logout, GET is simpler here

// --- Password Management (Add later) ---
// router.post('/forgotPassword', forgotPassword);
// router.patch('/resetPassword/:token', resetPassword);


// --- Protected Routes (User must be logged in) ---
router.use(protect); // All routes below this middleware require authentication

router.patch('/updateMyPassword', updatePassword);

router.get('/me', getMe, getUser); // Use getMe middleware to set id, then getUser
router.patch('/updateMe', updateMe);
router.delete('/deleteMe', deleteMe); // User deactivates their own account

// --- Admin Routes (User must be logged in AND be an admin) ---
router.use(restrictTo('admin')); // All routes below require 'admin' role

router
  .route('/')
  .get(getAllUsers);

router
  .route('/:id')
  .get(getUser)
  .patch(updateUser)    // Admin can update user data (carefully defined fields)
  .delete(deleteUser);  // Admin can permanently delete users

export default router;