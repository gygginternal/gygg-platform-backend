import express from 'express';
import { param } from 'express-validator';
import validateRequest from '../middleware/validateRequest.js';
import {
    createPaymentIntentForContract,  // Function to create a payment intent for a specific contract
    refundPaymentForContract,       // Function to process a refund for a specific contract
} from '../controllers/paymentController.js';
import { protect, restrictTo } from '../controllers/authController.js';  // Middleware for authentication and authorization

const router = express.Router();

/**
 * --- Protect Routes ---
 * All routes below this middleware require the user to be logged in.
 */
router.use(protect); // Protect all routes below this middleware (user must be logged in)


/**
 * --- Payment Routes ---
 * These routes handle the creation of payment intents and refunds for contracts.
 */

// Route to create a payment intent for a specific contract.
// Only accessible by users with the 'provider' role (the one offering the service).
router.post('/contracts/:contractId/create-payment-intent', [
    restrictTo('provider'), // Only the provider can create a payment intent
    param('contractId').isMongoId().withMessage('Invalid Contract ID format'), // Validate contractId as MongoDB ObjectId
], validateRequest, createPaymentIntentForContract); // Calls the controller to handle payment intent creation


// Route to refund a payment for a specific contract.
// Only accessible by users with 'admin' or 'provider' roles (admins and the provider can issue a refund).
router.post('/contracts/:contractId/refund', [
    restrictTo('admin', 'provider'), // Only admin or provider can refund
    param('contractId').isMongoId().withMessage('Invalid Contract ID format'), // Validate contractId as MongoDB ObjectId
    // Optional: body('reason').optional().trim().escape()  // If you want to add a reason for the refund later
], validateRequest, refundPaymentForContract); // Calls the controller to handle payment refund

export default router;
