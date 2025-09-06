// src/routes/contractRoutes.js

import express from "express";
import { param, query, body } from "express-validator";
import validateRequest from "../middleware/validateRequest.js";
import { protect, restrictTo } from "../controllers/authController.js";
import {
  getContract,
  submitWork, // Import the specific function
  approveCompletionAndRelease, // Import the specific function
  payTasker, // Import the new pay tasker function
  requestRevision, // Import the specific function
  cancelContract,
  deleteContract, // Import the specific function
  getMyContracts, // Import the specific function
  getMyContractsWithPayments, // <-- Add this import
  resetContractForTesting, // Import the testing function
} from "../controllers/contractController.js"; // Create this controller

const router = express.Router();
router.use(protect); // Apply 'protect' middleware to all routes in this router

router.get(
  "/my-contracts",
  restrictTo("provider", "tasker"), // Accessible to both providers and taskers
  getMyContracts // Calls the controller to handle the request
);

// --- Route: Get contract(s) ---
// @route   GET /api/v1/contracts?gigId=...
// @desc    Get a contract for a specific gig (only accessible to provider or tasker involved)
// @access  Private (protected route)
router.get(
  "/",
  [
    query("gigId")
      .isMongoId()
      .withMessage("Valid Gig ID query parameter required"),
    // Add other query validations if needed
  ],
  validateRequest,
  getContract
); // Using getContract which expects gigId query param

// --- Route: Get specific contract by ID ---
// @route   GET /api/v1/contracts/:id
// @desc    Get a specific contract by its ID
// @access  Private (protected route)
router.get(
  "/:id",
  [param("id").isMongoId().withMessage("Invalid Contract ID format")],
  validateRequest,
  getContract
); // Assume getContract can handle ID param too (adjust controller)

// --- Route: Tasker submits work ---
// @route   PATCH /api/v1/contracts/:id/submit-work
// @desc    Tasker submits work for a contract
// @access  Private (only accessible to tasker)
router.patch(
  "/:id/submit-work",
  [
    restrictTo("tasker"), // Only tasker can submit work
    param("id").isMongoId().withMessage("Invalid Contract ID format"),
    // Add body validation if proof/notes are submitted
  ],
  validateRequest,
  submitWork
); // Using a generic status updater

// --- Route: Provider approves completion ---
// @route   PATCH /api/v1/contracts/:id/approve-completion
// @desc    Provider approves completion of work and triggers payout (if applicable)
// @access  Private (only accessible to provider)
router.patch(
  "/:id/approve-completion",
  [
    restrictTo("provider"), // Only provider can approve completion
    param("id").isMongoId().withMessage("Invalid Contract ID format"),
  ],
  validateRequest,
  approveCompletionAndRelease
);

// --- Route: Provider pays tasker ---
// @route   PATCH /api/v1/contracts/:id/pay-tasker
// @desc    Provider pays the tasker and marks contract as completed
// @access  Private (only accessible to provider)
router.patch(
  "/:id/pay-tasker",
  [
    restrictTo("provider"), // Only provider can pay tasker
    param("id").isMongoId().withMessage("Invalid Contract ID format"),
  ],
  validateRequest,
  payTasker
);

router.patch(
  "/:id/request-revision",
  [
    restrictTo("provider"), // Only provider requests revision
    param("id").isMongoId().withMessage("Invalid Contract ID format"),
    body("reason")
      .notEmpty()
      .withMessage("Reason for revision is required")
      .trim()
      .escape(),
  ],
  validateRequest,
  requestRevision
); // <<< Use the correct controller

// --- Route: Cancel Contract ---
// PATCH /api/v1/contracts/:id/cancel
router.patch(
  "/:id/cancel",
  [
    param("id").isMongoId().withMessage("Invalid Contract ID format"),
    body("reason").optional({ checkFalsy: true }).trim().escape(), // Optional reason
  ],
  validateRequest,
  cancelContract
); // <<< Use the correct controlle

router.delete(
  "/:id",
  [
    param("id").isMongoId().withMessage("Invalid Contract ID format"), // Validate contract ID
  ],
  validateRequest,
  deleteContract
); // Calls the controller to handle deletion

// Route to get all contracts of the current logged-in user

router.get(
  "/my-contracts-with-payments",
  restrictTo("provider", "tasker"),
  getMyContractsWithPayments
);

// --- Route: Reset contract status for testing (Development only) ---
// @route   PATCH /api/v1/contracts/:id/reset-for-testing
// @desc    Reset contract status for testing purposes
// @access  Private (Development only)
router.patch(
  "/:id/reset-for-testing",
  [
    param("id").isMongoId().withMessage("Invalid Contract ID format"),
    body("newStatus")
      .isIn(['active', 'submitted', 'pending_payment', 'completed', 'cancelled'])
      .withMessage("Invalid status. Allowed: active, submitted, pending_payment, completed, cancelled"),
  ],
  validateRequest,
  resetContractForTesting
);

export default router;
