import express from "express";
import { body, param } from "express-validator";
import validateRequest from "../middleware/validateRequest.js";
import { protect, restrictTo } from "../controllers/authController.js";
import {
  rejectApplication,
  acceptApplication,
  cancelApplication,
  topMatchApplications,
  getMyAppliedGigs,
} from "../controllers/applicationController.js";

const router = express.Router();

// --- Protect Routes ---
// All routes below this middleware require the user to be logged in.
router.use(protect); // Protect all routes below this middleware (user must be logged in)

// Route to accept an application
router.patch(
  "/:applicationId/accept",
  [
    restrictTo("provider"), // Only providers can accept applications
    param("applicationId")
      .isMongoId()
      .withMessage("Invalid Application ID format. Must be a valid MongoDB ObjectId."),
  ],
  validateRequest,
  acceptApplication // Calls the controller to handle acceptance
);

// Route to mark an application as rejected
router.patch(
  "/:applicationId/reject",
  [
    param("applicationId")
      .isMongoId()
      .withMessage("Invalid Application ID format. Must be a valid MongoDB ObjectId."), // Validate application ID
  ],
  validateRequest,
  rejectApplication // Calls the controller to handle rejection
);

// Route to cancel an application
router.patch(
  "/:applicationId/cancel",
  [
    restrictTo("tasker"), // Only taskers can cancel their applications
    param("applicationId")
      .isMongoId()
      .withMessage("Invalid Application ID format. Must be a valid MongoDB ObjectId."), // Validate application ID
  ],
  validateRequest,
  cancelApplication // Calls the controller to handle cancellation
);

// --- Route: Get Top Matching Applications ---
// @route   GET /api/v1/applications/top-match
// @desc    Get the top matching applications for the logged-in user
// @access  Private (only accessible to users)
router.get(
  "/top-match",
  protect,
  restrictTo("provider"),
  topMatchApplications
);

// Add route for tasker to get gigs they've applied to
router.get('/my-gigs', getMyAppliedGigs);

export default router; 