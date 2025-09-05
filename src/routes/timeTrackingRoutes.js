import express from "express";
import { body, param, query } from "express-validator";
import { protect, restrictTo } from "../controllers/authController.js";
import validateRequest from "../middleware/validateRequest.js";
import {
  startTimeTracking,
  stopTimeTracking,
  getTimeEntries,
  reviewTimeEntry,
  getActiveSession,
  getTimeTrackingSummary
} from "../controllers/timeTrackingController.js";

const router = express.Router();

// All routes require authentication
router.use(protect);

// Validation middleware
const contractIdValidation = [
  param("contractId").isMongoId().withMessage("Invalid contract ID format")
];

const timeEntryIdValidation = [
  param("timeEntryId").isMongoId().withMessage("Invalid time entry ID format")
];

const startTimeValidation = [
  ...contractIdValidation,
  body("description")
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage("Description cannot exceed 500 characters")
];

const stopTimeValidation = [
  ...contractIdValidation,
  body("description")
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage("Description cannot exceed 500 characters")
];

const reviewTimeValidation = [
  ...timeEntryIdValidation,
  body("action")
    .isIn(["approve", "reject"])
    .withMessage("Action must be either 'approve' or 'reject'"),
  body("notes")
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage("Notes cannot exceed 500 characters")
];

const getTimeEntriesValidation = [
  ...contractIdValidation,
  query("status")
    .optional()
    .isIn(["active", "submitted", "approved", "rejected", "all"])
    .withMessage("Invalid status filter"),
  query("page")
    .optional()
    .isInt({ min: 1 })
    .toInt()
    .withMessage("Page must be a positive integer"),
  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .toInt()
    .withMessage("Limit must be between 1 and 100")
];

/**
 * ===============================
 *        TIME TRACKING ROUTES
 * ===============================
 */

// Start time tracking session (Taskers only)
router.post(
  "/contracts/:contractId/start",
  restrictTo("tasker"),
  startTimeValidation,
  validateRequest,
  startTimeTracking
);

// Stop time tracking session (Taskers only)
router.post(
  "/contracts/:contractId/stop",
  restrictTo("tasker"),
  stopTimeValidation,
  validateRequest,
  stopTimeTracking
);

// Get active session for a contract (Taskers only)
router.get(
  "/contracts/:contractId/active",
  restrictTo("tasker"),
  contractIdValidation,
  validateRequest,
  getActiveSession
);

// Get time entries for a contract (Provider and Tasker)
router.get(
  "/contracts/:contractId/entries",
  getTimeEntriesValidation,
  validateRequest,
  getTimeEntries
);

// Get time tracking summary for a contract (Provider and Tasker)
router.get(
  "/contracts/:contractId/summary",
  contractIdValidation,
  validateRequest,
  getTimeTrackingSummary
);

// Review (approve/reject) time entry (Providers only)
router.patch(
  "/entries/:timeEntryId/review",
  restrictTo("provider"),
  reviewTimeValidation,
  validateRequest,
  reviewTimeEntry
);

export default router;