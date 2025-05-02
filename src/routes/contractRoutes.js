// src/routes/contractRoutes.js

import express from 'express';
import Contract from '../models/Contract.js'; // Mongoose model for Contract
import { protect } from '../controllers/authController.js'; // Middleware to protect routes (ensures user is logged in)
import catchAsync from '../utils/catchAsync.js'; // Utility to catch async errors and pass them to global error handler
import AppError from '../utils/AppError.js'; // Custom error class for consistent error formatting

const router = express.Router();

// --- Middleware ---
// Apply 'protect' middleware to all routes in this router
router.use(protect);

/**
 * @route   GET /api/v1/contracts?gigId=...
 * @desc    Get a contract for a specific gig (only accessible to provider or tasker involved)
 * @access  Private (protected route)
 */
router.get('/', catchAsync(async (req, res, next) => {
    console.log('GET /contracts route hit. Query:', req.query);

    // --- Validate and Build Filter ---
    const { gigId } = req.query;

    if (!gigId) {
        return next(new AppError('Gig ID query parameter is required.', 400));
    }

    const filter = { gig: gigId };

    // --- Query Database ---
    const contract = await Contract.findOne(filter)
        // .populate('provider', 'firstName lastName') // Uncomment if needed
        // .populate('tasker', 'firstName lastName');   // Uncomment if needed

    // --- Handle No Contract Found ---
    if (!contract) {
        console.log(`No contract found for gigId: ${gigId}`);
        return res.status(200).json({
            status: 'success',
            data: { contract: null } // Important for frontend: always return a consistent structure
        });
    }

    console.log(`Found contract ${contract._id} for gigId: ${gigId}`);
    console.log(`Checking Auth: User=${req.user.id}, Provider=${contract.provider._id}, Tasker=${contract.tasker._id}`);

    // --- Authorization Check ---
    // Ensure the logged-in user is either the provider or the tasker for the contract
    const isAuthorized = contract.provider._id.equals(req.user.id) || contract.tasker._id.equals(req.user.id);

    if (!isAuthorized) {
        console.warn(`Unauthorized access attempt by user ${req.user.id} on contract ${contract._id}`);
        return next(new AppError('Not authorized to view this contract', 403));
    }

    console.log(`Auth passed for user ${req.user.id} on contract ${contract._id}`);

    // --- Return Contract ---
    res.status(200).json({
        status: 'success',
        data: { contract }
    });
}));

// --- Future Route Placeholders (if needed) ---
// GET /api/v1/contracts/:id
// router.get('/:id', protect, getContractController);

// PATCH /api/v1/contracts/:id/submit-work
// router.patch('/:id/submit-work', protect, restrictTo('tasker'), submitWorkController);

// PATCH /api/v1/contracts/:id/approve-completion
// router.patch('/:id/approve-completion', protect, restrictTo('provider'), approveCompletionController);

export default router;
