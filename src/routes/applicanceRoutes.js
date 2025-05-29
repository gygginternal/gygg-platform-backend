import express from "express";
import { body, param } from "express-validator";
import validateRequest from "../middleware/validateRequest.js";
import { protect, restrictTo } from "../controllers/authController.js";
import {
  rejectApplicance,
  offerApplication,
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
    restrictTo("provider"), // Only providers can reject an applicance
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

export default router;
