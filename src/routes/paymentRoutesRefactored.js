import express from "express";
import { param, body } from "express-validator";
import validateRequest from "../middleware/validateRequest.js";
import {
  createPaymentIntentForContract,
  refundPaymentForContract,
  releasePaymentForContract,
  checkIfContractIsReleasable,
  getPayments,
  getInvoicePdf,
  getBalance,
  processWithdrawal,
  confirmPaymentSuccess,
  createConnectedAccount,
  createAccountLink,
  getAccountStatus,
  getEarningsSummary,
  getPaymentHistory,
} from "../controllers/paymentController.js";
import { protect, restrictTo } from "../controllers/authController.js";

const router = express.Router();

/**
 * --- Protect Routes ---
 * All routes below this middleware require the user to be logged in.
 */
router.use(protect); // Protect all routes below this middleware (user must be logged in)

// Route to get all payments
router.get(
  "/",
  [
    restrictTo("admin", "provider", "tasker"), // Accessible to admin, provider, and tasker
    param("status").optional().isString().withMessage("Invalid status format"), // Optional status filter
  ],
  validateRequest,
  getPayments // Calls the controller to handle payment retrieval
);

// Route to get available balance for withdrawal
router.get(
  "/balance",
  [
    restrictTo("tasker"), // Only taskers can check their balance
  ],
  validateRequest,
  getBalance
);

// Route to get comprehensive earnings summary
router.get(
  "/earnings-summary",
  [
    restrictTo("provider", "tasker"), // Both providers and taskers can view earnings
  ],
  validateRequest,
  getEarningsSummary
);

// Route to get detailed payment history
router.get(
  "/payment-history",
  [
    restrictTo("provider", "tasker"), // Both providers and taskers can view payment history
  ],
  validateRequest,
  getPaymentHistory
);

// Route to process withdrawal request
router.post(
  "/withdraw",
  [
    restrictTo("tasker"), // Only taskers can withdraw
    body("amount")
      .isFloat({ min: 0.01 })
      .withMessage("Valid withdrawal amount (minimum $0.01) is required"),
    body("paymentGateway")
      .optional()
      .isString()
      .withMessage("Invalid payment gateway"),
  ],
  validateRequest,
  processWithdrawal
);

/**
 * --- Payment Routes ---
 * These routes handle the creation of payment intents and refunds for contracts.
 */

// Route to create a payment intent for a specific contract.
// Only accessible by users with the 'provider' role (the one offering the service).
router.post(
  "/contracts/:contractId/create-payment-intent",
  [
    restrictTo("provider"), // Only the provider can create a payment intent
    param("contractId").isMongoId().withMessage("Invalid Contract ID format"), // Validate contractId as MongoDB ObjectId
    body("paymentGateway")
      .optional()
      .isString()
      .withMessage("Invalid payment gateway"),
  ],
  validateRequest,
  createPaymentIntentForContract
); // Calls the controller to handle payment intent creation

// Route to confirm payment success from frontend
router.post(
  "/confirm-payment-success",
  [
    restrictTo("provider"), // Only the provider can confirm payment
    body("paymentIntentId").notEmpty().withMessage("Payment Intent ID is required"),
    body("gateway")
      .optional()
      .isString()
      .withMessage("Invalid payment gateway"),
  ],
  validateRequest,
  confirmPaymentSuccess
);

// Route to refund a payment for a specific contract.
// Only accessible by users with 'admin' or 'provider' roles (admins and the provider can issue a refund).
router.post(
  "/contracts/:contractId/refund",
  [
    restrictTo("admin", "provider"), // Only admin or provider can refund
    param("contractId").isMongoId().withMessage("Invalid Contract ID format"), // Validate contractId as MongoDB ObjectId
    // Optional: body('reason').optional().trim().escape()  // If you want to add a reason for the refund later
  ],
  validateRequest,
  refundPaymentForContract
); // Calls the controller to handle payment refund

// Route to release a payment for a specific contract (escrow release)
router.post(
  "/contracts/:contractId/release",
  [
    restrictTo("admin", "provider"), // Only admin or provider can release payment
    param("contractId").isMongoId().withMessage("Invalid Contract ID format"), // Validate contractId as MongoDB ObjectId
  ],
  validateRequest,
  releasePaymentForContract // Calls the controller to handle payment release
);

router.get(
  "/contracts/:contractId/releasable",
  [
    restrictTo("admin", "provider"), // Only admin or provider can check releasability
    param("contractId").isMongoId().withMessage("Invalid Contract ID format"), // Validate contractId as MongoDB ObjectId
  ],
  validateRequest,
  checkIfContractIsReleasable // Calls the controller to check releasability
);

// Route to get PDF invoice for a payment
router.get(
  "/:paymentId/invoice-pdf",
  [
    param("paymentId").isMongoId().withMessage("Invalid Payment ID format"),
  ],
  validateRequest,
  getInvoicePdf
);

// Route to create a connected account for the user
router.post(
  "/create-connected-account",
  protect,
  restrictTo("tasker", "provider"),
  [
    body("paymentGateway")
      .optional()
      .isString()
      .withMessage("Invalid payment gateway"),
  ],
  validateRequest,
  createConnectedAccount
);

// Route to initiate an account link for onboarding
router.post(
  "/initiate-account-link",
  protect,
  restrictTo("tasker", "provider"),
  createAccountLink
);

// Route to check account status
router.get(
  "/account-status",
  protect,
  restrictTo("tasker", "provider"),
  getAccountStatus
);

export default router;