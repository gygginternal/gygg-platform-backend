// src/routes/contractRoutes.js

import express from 'express';
import { param, query, body } from 'express-validator';
import validateRequest from '../middleware/validateRequest.js';
import { protect, restrictTo } from '../controllers/authController.js';
import {
    getContract,
    submitWork,                   // Import the specific function
    approveCompletionAndRelease,  // Import the specific function
    requestRevision,              // Import the specific function
    cancelContract                // Import the specific function
} from '../controllers/contractController.js'; // Create this controller

const router = express.Router();
router.use(protect); // Apply 'protect' middleware to all routes in this router

// --- Route: Get contract(s) ---
// @route   GET /api/v1/contracts?gigId=...
// @desc    Get a contract for a specific gig (only accessible to provider or tasker involved)
// @access  Private (protected route)
router.get('/', [
    query('gigId').isMongoId().withMessage('Valid Gig ID query parameter required'),
    // Add other query validations if needed
], validateRequest, getContract); // Using getContract which expects gigId query param

// --- Route: Get specific contract by ID ---
// @route   GET /api/v1/contracts/:id
// @desc    Get a specific contract by its ID
// @access  Private (protected route)
router.get('/:id', [
    param('id').isMongoId().withMessage('Invalid Contract ID format'),
], validateRequest, getContract); // Assume getContract can handle ID param too (adjust controller)

// --- Route: Tasker submits work ---
// @route   PATCH /api/v1/contracts/:id/submit-work
// @desc    Tasker submits work for a contract
// @access  Private (only accessible to tasker)
router.patch('/:id/submit-work', [
    restrictTo('tasker'), // Only tasker can submit work
    param('id').isMongoId().withMessage('Invalid Contract ID format'),
    // Add body validation if proof/notes are submitted
], validateRequest, submitWork); // Using a generic status updater

// --- Route: Provider approves completion ---
// @route   PATCH /api/v1/contracts/:id/approve-completion
// @desc    Provider approves completion of work and triggers payout (if applicable)
// @access  Private (only accessible to provider)
router.patch('/:id/approve-completion', [
    restrictTo('provider'), // Only provider can approve completion
    param('id').isMongoId().withMessage('Invalid Contract ID format'),
], validateRequest, approveCompletionAndRelease);

router.patch('/:id/request-revision', [
    restrictTo('provider'), // Only provider requests revision
    param('id').isMongoId().withMessage('Invalid Contract ID format'),
    body('reason').notEmpty().withMessage('Reason for revision is required').trim().escape(),
], validateRequest, requestRevision); // <<< Use the correct controller


// --- Route: Cancel Contract ---
// PATCH /api/v1/contracts/:id/cancel
router.patch('/:id/cancel', [
    param('id').isMongoId().withMessage('Invalid Contract ID format'),
    body('reason').optional({ checkFalsy: true }).trim().escape(), // Optional reason
], validateRequest, cancelContract); // <<< Use the correct controlle

// --- Future Route Placeholders (if needed) ---
// PATCH /api/v1/contracts/:id/cancel
// router.patch('/:id/cancel', protect, restrictTo('provider', 'tasker'), cancelContractController);

// Add other status updates (cancel, dispute) as needed

export default router;
