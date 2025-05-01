import express from 'express';
import {
  getAllGigs,    // Function to retrieve all gigs
  getGig,        // Function to get a specific gig by its ID
  createGig,     // Function to create a new gig
  updateGig,     // Function to update an existing gig
  deleteGig,     // Function to delete a gig
  acceptGig,     // Function for a tasker to accept a gig
} from '../controllers/gigController.js';
import { protect, restrictTo } from '../controllers/authController.js'; // Middleware to protect routes that require authentication and restrict roles

const router = express.Router();

/**
 * --- Protect Routes ---
 * All routes below this middleware require the user to be logged in.
 */
router.use(protect); // Protect all routes below this middleware (user must be logged in)


/**
 * --- Gig Routes ---
 * These routes allow users to view, create, update, or delete gigs.
 * Permissions for creating, updating, and deleting gigs are handled by the controller.
 */

// Route to get all gigs (accessible by any logged-in user)
router.route('/')
  .get(getAllGigs)        // Get the list of all gigs
  .post(restrictTo('provider'), createGig);  // Only 'provider' role can create a new gig

/**
 * --- Individual Gig Routes ---
 * These routes allow users to view, update, or delete a specific gig by its ID.
 * Permissions for updating or deleting gigs should be checked in the controller (e.g., by verifying if the user is the owner or an admin).
 */

// Route to get a specific gig by its ID (accessible by any logged-in user)
router.route('/:id')
  .get(getGig)             // Get the gig by ID
  .patch(updateGig)        // Update the gig (permissions checked in the controller, e.g., owner or admin)
  .delete(deleteGig);      // Delete the gig (permissions checked in the controller, e.g., owner or admin)


/**
 * --- Tasker Accepts Gig ---
 * This route allows a tasker to accept a gig.
 * Only users with the 'tasker' role are permitted to accept gigs.
 */

// Route to accept a gig (only accessible by taskers)
router.patch('/:id/accept', restrictTo('tasker'), acceptGig); // Only tasker role can accept the gig

export default router;
