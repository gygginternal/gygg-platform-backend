import express from "express";
import { param, body, query } from "express-validator";
import validateRequest from "../middleware/validateRequest.js";
import {
  createNuveiPaymentSessionForContract,
  getNuveiPaymentSessionForContract,
  confirmNuveiPaymentForContract,
  verifyNuveiTransaction,
  processNuveiWithdrawal,
  getNuveiPaymentHistory,
  getNuveiEarningsSummary,
  startNuveiOnboarding,
  checkNuveiOnboardingStatus,
  setDefaultNuveiPaymentMethod,
  getUserNuveiPaymentMethods,
  getNuveiBalance,
  getNuveiWithdrawalHistory,
  handleNuveiWebhook,
  nuveiDemoResponse,
  nuveiDefaultCancel,
} from "../controllers/nuveiPaymentController.js";
import { protect, restrictTo } from "../controllers/authController.js";

const router = express.Router();

// Routes for Nuvei demo response and cancel endpoints (for testing)
// These need to be accessible without authentication since they're callbacks from Nuvei
router.post("/nuvei/demo-response", nuveiDemoResponse);
router.get("/nuvei/demo-response", nuveiDemoResponse); // Also support GET requests
router.post("/nuvei/default-cancel", nuveiDefaultCancel);
router.get("/nuvei/default-cancel", nuveiDefaultCancel);

/** 
 * --- Protect Routes ---
 * All routes below this middleware require the user to be logged in.
 */
router.use(protect); // Protect all routes below this middleware (user must be logged in)

// --- Nuvei Payment Routes ---
// These routes handle the creation of payment sessions and refunds for contracts using Nuvei.

// Route to create a payment session for a specific contract using Nuvei
router.post(
  "/contracts/:contractId/create-nuvei-payment-session",
  [
    restrictTo("provider"), // Only providers can create Nuvei payments
    param("contractId").isMongoId().withMessage("Invalid Contract ID format"), // Validate contractId as MongoDB ObjectId
    body("paymentMethod")
      .optional()
      .isIn(["card", "instadebit", "ach", "bank_transfer"])
      .withMessage("Invalid payment method. Supported: card, instadebit, ach, bank_transfer"),
  ],
  validateRequest,
  createNuveiPaymentSessionForContract
);

// Route to get Nuvei payment session details
router.get(
  "/nuvei/session/:sessionId",
  [
    param("sessionId").notEmpty().withMessage("Session ID is required"),
  ],
  validateRequest,
  getNuveiPaymentSessionForContract
);

// Route to confirm Nuvei payment completion
router.post(
  "/nuvei/confirm-payment",
  [
    body("nuveiTransactionId").optional().isString().withMessage("Invalid Nuvei transaction ID"),
    body("sessionId").optional().isString().withMessage("Invalid session ID"),
  ],
  validateRequest,
  confirmNuveiPaymentForContract
);

// Route to verify a Nuvei transaction
router.get(
  "/nuvei/verify-transaction/:transactionId",
  [
    param("transactionId").notEmpty().withMessage("Transaction ID is required"),
  ],
  validateRequest,
  verifyNuveiTransaction
);

// --- Nuvei Withdrawal Routes ---
// These routes handle withdrawal requests using Nuvei bank transfers

// Route to process Nuvei withdrawal
router.post(
  "/nuvei/withdraw",
  [
    restrictTo("tasker"), // Only taskers can withdraw via Nuvei
    body("amount")
      .isFloat({ min: 0.01 })
      .withMessage("Valid withdrawal amount (minimum $0.01) is required"),
  ],
  validateRequest,
  processNuveiWithdrawal
);

// Route to get Nuvei withdrawal history
router.get(
  "/nuvei/withdrawal-history",
  [
    restrictTo("tasker"), // Only taskers can view their Nuvei withdrawal history
    query("page")
      .optional()
      .isInt({ min: 1 })
      .toInt()
      .withMessage("Page must be a positive integer"),
    query("limit")
      .optional()
      .isInt({ min: 1, max: 50 })
      .toInt()
      .withMessage("Limit must be between 1 and 50"),
  ],
  validateRequest,
  getNuveiWithdrawalHistory
);

// --- Nuvei Payment History Routes ---
// These routes handle payment history and earnings summary for Nuvei payments

// Route to get Nuvei payment history
router.get(
  "/nuvei/payment-history",
  [
    restrictTo("provider", "tasker"), // Both can view their payment history
    query("type")
      .optional()
      .isIn(["all", "earned", "spent", "withdrawals"])
      .withMessage("Type must be 'all', 'earned', 'spent', or 'withdrawals'"),
    query("status")
      .optional()
      .isIn(["all", "pending", "requires_payment_method", "processing", "succeeded", "failed", "refunded", "cancelled"])
      .withMessage("Invalid status filter"),
    query("page")
      .optional()
      .isInt({ min: 1 })
      .toInt()
      .withMessage("Page must be a positive integer"),
    query("limit")
      .optional()
      .isInt({ min: 1, max: 50 })
      .toInt()
      .withMessage("Limit must be between 1 and 50"),
  ],
  validateRequest,
  getNuveiPaymentHistory
);

// Route to get Nuvei earnings summary
router.get(
  "/nuvei/earnings-summary",
  [
    restrictTo("provider", "tasker"), // Both can view their earnings summary
    query("period")
      .optional()
      .isIn(["all", "week", "month", "year", "custom"])
      .withMessage("Period must be 'all', 'week', 'month', 'year', or 'custom'"),
    query("startDate")
      .optional()
      .isISO8601()
      .withMessage("Start date must be a valid ISO date"),
    query("endDate")
      .optional()
      .isISO8601()
      .withMessage("End date must be a valid ISO date"),
  ],
  validateRequest,
  getNuveiEarningsSummary
);

// --- Nuvei Account Management Routes ---
// These routes handle Nuvei onboarding and account management

// Route to start Nuvei onboarding process
router.post(
  "/nuvei/start-onboarding",
  [
    restrictTo("tasker", "provider"), // Both can start Nuvei onboarding
  ],
  validateRequest,
  startNuveiOnboarding
);

// Route to check Nuvei onboarding status
router.get(
  "/nuvei/onboarding-status",
  [
    restrictTo("tasker", "provider"), // Both can check their onboarding status
  ],
  validateRequest,
  checkNuveiOnboardingStatus
);

// Route to set default payment method
router.patch(
  "/nuvei/default-payment-method",
  [
    restrictTo("tasker", "provider"), // Both can set their default payment method
    body("defaultPaymentMethod")
      .isIn(["nuvei", "stripe"])
      .withMessage("Payment method must be 'nuvei' or 'stripe'"),
  ],
  validateRequest,
  setDefaultNuveiPaymentMethod
);

// Route to get all payment methods for user
router.get(
  "/nuvei/user-payment-methods",
  [
    restrictTo("tasker", "provider"), // Both can get their payment methods
  ],
  validateRequest,
  getUserNuveiPaymentMethods
);

// Route to get Nuvei balance
router.get(
  "/nuvei/balance",
  [
    restrictTo("tasker", "provider"), // Both can check their Nuvei balance
  ],
  validateRequest,
  getNuveiBalance
);

// Webhook endpoint for Nuvei payment confirmations
router.post(
  "/webhook/nuvei",
  // No authentication needed as this is a webhook from Nuvei
  handleNuveiWebhook
);

export default router;