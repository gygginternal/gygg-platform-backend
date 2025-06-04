import express from "express";
import { body, param } from "express-validator";
import validateRequest from "../middleware/validateRequest.js";
import { protect, restrictTo } from "../controllers/authController.js";
import {
  rejectApplicance,
  offerApplication,
  cancelApplicance,
  topMatchApplicances,
} from "../controllers/applicanceController.js";

const router = express.Router();

/**
 * --- Protect Routes ---
 * All routes below this middleware require the user to be logged in.
 */
router.use(protect); // Protect all routes below this middleware (user must be logged in)

// Route to mark an applicance as rejected
router.patch(
  "/:applicanceId/reject",
  [
    param("applicanceId")
      .isMongoId()
      .withMessage("Invalid Applicance ID format"), // Validate applicance ID
  ],
  validateRequest,
  rejectApplicance // Calls the controller to handle rejection
);

router.patch(
  "/:applicationId/offer",
  [
    restrictTo("provider"), // Only providers can offer an application
    param("applicationId")
      .isMongoId()
      .withMessage("Invalid Application ID format"), // Validate application ID
  ],
  validateRequest,
  offerApplication // Calls the controller to handle the offer
);

// Route to cancel an application
router.patch(
  "/:applicanceId/cancel",
  [
    restrictTo("tasker"), // Only taskers can cancel their applications
    param("applicanceId")
      .isMongoId()
      .withMessage("Invalid Applicance ID format"), // Validate applicance ID
  ],
  validateRequest,
  cancelApplicance // Calls the controller to handle cancellation
);

// --- Route: Get Top Matching Appliances ---
// @route   GET /api/v1/applicances/top-match
// @desc    Get the top 3 matching appliances for the logged-in user
// @access  Private (only accessible to users)
router.get(
  "/top-match",
  restrictTo("provider", "tasker"), // Accessible to providers and taskers
  topMatchApplicances // Calls the controller to handle the request
);

export default router;
