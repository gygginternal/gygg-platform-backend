import express from "express";
import { body, param, query } from "express-validator";
import validateRequest from "../middleware/validateRequest.js";
import {
  getAllGigs, // Retrieve all gigs
  getGig, // Retrieve a specific gig by ID
  createGig, // Create a new gig
  updateGig, // Update a gig by ID
  deleteGig, // Delete a gig by ID
  acceptGig, // Tasker accepts a gig
  matchGigsForTasker,
  getMyApplicationForGig,
  getMyGigsWithNoApplications, // Match gigs to a tasker based on their hobbies and personality traits
  applyToGig,
} from "../controllers/gigController.js";

import { protect, restrictTo } from "../controllers/authController.js"; // Auth middlewares to secure and authorize access
import {
  listGigApplications,
} from "../controllers/applicationController.js";
import { topMatchGigs } from "../controllers/taskersController.js";
import { getOfferByApplication } from "../controllers/offerController.js"; // Import the controller

const router = express.Router();

/**
 * ===============================
 * ===============================
 * Reusable field validation rules for gig creation and updates.
 */

// Required validation for creating a gig
const gigBodyValidation = [
  body("title").notEmpty().trim().escape().isLength({ max: 100 }),
  body("description").notEmpty().trim().escape(),
  body("category").notEmpty(),
  body("subcategory").optional().trim().escape(),
  body("isHourly").optional().isBoolean().toBoolean(),
  body("cost")
    .optional()
    .isNumeric()
    .toFloat({ min: 0.01 })
    .withMessage("Cost must be a positive number"),
  body("ratePerHour")
    .optional()
    .isNumeric()
    .toFloat({ min: 0.01 })
    .withMessage("Hourly rate must be a positive number"),
  body("estimatedHours")
    .optional({ checkFalsy: true })
    .isNumeric()
    .toFloat({ min: 0.1 })
    .withMessage("Estimated hours must be at least 0.1"),
  body("location").optional().isObject(),
  body("location.address").optional({ checkFalsy: true }).trim().escape(),
  body("location.city").optional({ checkFalsy: true }).trim().escape(),
  body("location.state").optional({ checkFalsy: true }).trim().escape(),
  body("location.postalCode").optional({ checkFalsy: true }).trim().escape(),
  body("location.country").optional({ checkFalsy: true }).trim().escape(),
  body("isRemote").optional().isBoolean().toBoolean(),
  body("deadline").optional({ checkFalsy: true }).isISO8601().toDate(),
  body("duration")
    .optional({ checkFalsy: true })
    .isNumeric()
    .toFloat({ min: 0.1 }),
  body("skills").optional().isArray(),
  body("skills.*").optional().isString().trim().escape(),
];

// Optional validation for updating a gig
const optionalGigBodyValidation = [
  body("title").optional().trim().escape().isLength({ max: 100 }),
  body("description").optional().trim().escape(),
  body("category")
    .optional()
    .isIn([
      "Household Services",
      "Personal Assistant",
      "Pet Care",
      "Technology and Digital Assistance",
      "Event Support",
      "Moving and Organization",
      "Creative and Costume Tasks",
      "General Errands",
      "Other",
    ]),
  body("subcategory").optional().trim().escape(),
  body("cost")
    .optional()
    .isNumeric()
    .toFloat({ min: 0.01 })
    .withMessage("Cost must be a positive number"),
  body("location.address").optional().trim().escape(),
  body("location.city").optional().trim().escape(),
  body("location.state").optional().trim().escape(),
  body("location.postalCode").optional().trim().escape(),
  body("location.country").optional().trim().escape(),
  body("isRemote").optional().isBoolean().toBoolean(),
  body("deadline").optional().isISO8601().toDate(),
  body("duration").optional().isNumeric().toFloat({ min: 0.1 }),
  body("skills").optional().isArray(),
  body("skills.*").optional().isString().trim().escape(),
];

/**
 * ===============================
 *          AUTH MIDDLEWARE
 * ===============================
 * All routes below require the user to be authenticated (logged in).
 */
router.use(protect);

/**
 * ===============================
 *            GIG ROUTES
 * ===============================
 * Allow users to view and manage gigs.
 */

// Route to get the offer of a gig
router.get(
  "/:gigId/offer",
  [
    param("gigId").isMongoId().withMessage("Invalid Gig ID format"), // Validate gig ID
  ],
  validateRequest,
  getOfferByApplication // Calls the controller to retrieve the offer
);

// Get all gigs (any logged-in user) OR create a gig (only provider)
router.get(
  "/awaiting-posted-gig",
  restrictTo("provider"), // Only providers can access this route
  getMyGigsWithNoApplications // Calls the controller to handle the request
);

router
  .route("/")
  .get(
    [
      query("page").optional().isInt({ min: 1 }).toInt(),
      query("limit").optional().isInt({ min: 1, max: 100 }).toInt(),
      query("sort").optional().isString().trim().escape(),
      query("status")
        .optional()
        .isIn([
          "open",
          "assigned",
          "active",
          "submitted",
          "approved",
          "completed",
          "cancelled",
          "pending_payment",
        ]),
      query("category")
        .optional()
        .isIn([
          "Household Services",
          "Personal Assistant",
          "Pet Care",
          "Technology and Digital Assistance",
          "Event Support",
          "Moving and Organization",
          "Creative and Costume Tasks",
          "General Errands",
          "Other",
        ]),
      validateRequest,
    ],
    getAllGigs
  )
  .post(restrictTo("provider"), gigBodyValidation, validateRequest, createGig);

/**
 * ===============================
 *        INDIVIDUAL GIG ROUTES
 * ===============================
 * Allow users to interact with specific gigs.
 * Permissions to update/delete are checked within controller (e.g., owner/admin).
 */
router.get(
  "/top-match",
  topMatchGigs // Calls the controller to handle the request
);

router
  .route("/:id")
  .get(
    param("id").isMongoId().withMessage("Invalid Gig ID format"),
    validateRequest,
    getGig
  )
  .patch(
    param("id").isMongoId().withMessage("Invalid Gig ID format"),
    optionalGigBodyValidation,
    validateRequest,
    updateGig
  )
  .delete(
    param("id").isMongoId().withMessage("Invalid Gig ID format"),
    validateRequest,
    deleteGig
  );

/**
 * ===============================
 *      ACCEPT GIG (TASKER ONLY)
 * ===============================
 * A tasker can accept a gig by its ID.
 */
router.patch(
  "/:id/accept",
  restrictTo("tasker"),
  param("id").isMongoId().withMessage("Invalid Gig ID format"),
  validateRequest,
  acceptGig
);

router.post(
  "/apply",
  [
    restrictTo("tasker"), // Only taskers can apply for a gig
  ],
  validateRequest,
  applyToGig // Calls the controller to handle the application
);

router.get(
  "/:gigId/applications",
  [
    restrictTo("provider"), // Only providers can view applications
    param("gigId").isMongoId().withMessage("Invalid Gig ID format"), // Validate gig ID
  ],
  validateRequest,
  listGigApplications // Calls the controller to list applications
);

// Add POST route for applying to a gig
router.post(
  "/:gigId/applications",
  restrictTo("tasker"),
  param("gigId").isMongoId().withMessage("Invalid Gig ID format"),
  validateRequest,
  applyToGig // Calls the controller to handle the application
);

router.get(
  "/:gigId/my-application",
  [
    restrictTo("tasker"), // Only taskers can view their application
    param("gigId").isMongoId().withMessage("Invalid Gig ID format"), // Validate gig ID
  ],
  validateRequest,
  getMyApplicationForGig // Calls the controller to handle the request
);

/**
 * ===============================
 *     MATCH GIGS FOR TASKER
 * ===============================
 * This route provides gig recommendations tailored to a tasker
 * based on their profile data such as hobbies, interests, and personality.
 */
router.get(
  "/match",
  restrictTo("tasker"),
  [
    query("page").optional().isInt({ min: 1 }).toInt(),
    query("limit").optional().isInt({ min: 1, max: 100 }).toInt(),
    validateRequest,
  ],
  matchGigsForTasker
);

export default router;
