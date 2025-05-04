import express from 'express';
import { body, param, query } from 'express-validator';
import validateRequest from '../middleware/validateRequest.js';
import {
    createReview, getAllReviews, getReview, updateReview, deleteReview,
} from '../controllers/reviewController.js';
import { protect, restrictTo } from '../controllers/authController.js';

const router = express.Router();

// Apply authentication middleware to all review routes
router.use(protect); // Protect all routes below this middleware (user must be logged in)


/**
 * --- Main Routes ---
 * These routes handle retrieving all reviews and creating new reviews.
 */

// Route to get all reviews (with optional filters like gigId, taskerId, providerId, etc.)
// Anyone logged in can GET reviews.
router
    .route('/')
    .get([ // Validation for filtering reviews
        query('gigId').optional().isMongoId().withMessage('Invalid Gig ID format'),
        query('taskerId').optional().isMongoId().withMessage('Invalid Tasker ID format'),
        query('providerId').optional().isMongoId().withMessage('Invalid Provider ID format'),
        query('page').optional().isInt({ min: 1 }).toInt(),
        query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    ], validateRequest, getAllReviews) // Calls the controller to handle fetching reviews

    .post([ // Validation for creating a review
        restrictTo('provider'), // Only Providers can POST (create) reviews
        body('contractId').notEmpty().isMongoId().withMessage('Valid Contract ID is required'),
        body('rating').notEmpty().isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5'),
        body('comment').optional({ checkFalsy: true }).trim().escape().isLength({ max: 1000 }),
    ], validateRequest, createReview); // Calls the controller to handle review creation


/**
 * --- Routes for Specific Review ID ---
 * These routes handle actions (GET, PATCH, DELETE) for a specific review.
 */

// Route to get a specific review by ID.
// Anyone logged in can GET a specific review.
router
    .route('/:id')
    .get(
        param('id').isMongoId().withMessage('Invalid Review ID format'), // Validate review ID
        validateRequest, // Check for validation errors
        getReview // Calls the controller to fetch a single review
    )

    .patch([ // Validation for updating a review
        restrictTo('provider', 'admin'), // Only the provider or admin can PATCH (update) reviews
        param('id').isMongoId().withMessage('Invalid Review ID format'), // Validate review ID
        body('rating').optional().isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5'),
        body('comment').optional({ checkFalsy: true }).trim().escape().isLength({ max: 1000 }),
        // Prevent changing other fields
        body('contractId').not().exists().withMessage('Cannot change contract ID'),
        body('gig').not().exists(),
        body('reviewer').not().exists(),
        body('reviewee').not().exists(),
    ], validateRequest, updateReview) // Calls the controller to update the review

    .delete([ // Validation for deleting a review
        restrictTo('provider', 'admin'), // Only provider or admin can DELETE reviews
        param('id').isMongoId().withMessage('Invalid Review ID format'), // Validate review ID
    ], validateRequest, deleteReview); // Calls the controller to delete the review

export default router;
