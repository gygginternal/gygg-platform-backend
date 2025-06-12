import express from "express";
import { body, param } from "express-validator";
import validateRequest from "../middleware/validateRequest.js";
import { protect, restrictTo } from "../controllers/authController.js";
import {
  acceptOffer,
  declineOffer,
  deleteOffer,
  getOfferByApplication, // Import getOfferByApplication controller
} from "../controllers/offerController.js";

const router = express.Router();

/**
 * --- Protect Routes ---
 * All routes below this middleware require the user to be logged in.
 */
router.use(protect); // Protect all routes below this middleware (user must be logged in)

// Route to accept an offer
router.patch(
  "/:offerId/accept",
  [
    restrictTo("tasker"), // Only taskers can accept an offer
    param("offerId").isMongoId().withMessage("Invalid Offer ID format"), // Validate offer ID
  ],
  validateRequest,
  acceptOffer // Calls the controller to handle offer acceptance
);

// Route to decline an offer
router.patch(
  "/:offerId/decline",
  [
    restrictTo("tasker"), // Only taskers can decline an offer
    param("offerId").isMongoId().withMessage("Invalid Offer ID format"), // Validate offer ID
  ],
  validateRequest,
  declineOffer // Calls the controller to handle offer decline
);

// Route to delete an offer
router.delete(
  "/:offerId",
  validateRequest,
  deleteOffer // Calls the controller to handle offer deletion
);

// Route to get the offer of an application
router.get(
  "/application/:applicationId",
  [
    param("applicationId")
      .isMongoId()
      .withMessage("Invalid Application ID format"), // Validate application ID
  ],
  validateRequest,
  getOfferByApplication // Calls the controller to retrieve the offer
);

export default router;
