import express from 'express';
import {
  getAllGigs,
  getGig,
  createGig,
  updateGig,
  deleteGig,
  acceptGig, // Add the acceptGig handler
} from '../controllers/gigController.js';
import { protect, restrictTo } from '../controllers/authController.js';

const router = express.Router();

// All gig routes require user to be logged in
router.use(protect);

router
  .route('/')
  .get(getAllGigs) // Any logged-in user can see gigs
  .post(restrictTo('provider'), createGig); // Only providers can create gigs

router
  .route('/:id')
  .get(getGig) // Any logged-in user can view a specific gig
  .patch(updateGig) // Logic inside controller checks ownership/admin
  .delete(deleteGig); // Logic inside controller checks ownership/admin

// Route for a Tasker to accept a gig
router.patch('/:id/accept', restrictTo('tasker'), acceptGig); // Only taskers can accept

export default router;