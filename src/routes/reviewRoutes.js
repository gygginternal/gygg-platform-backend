import express from 'express';
import {
    createReview,
    getAllReviews,
    getReview,
    updateReview,
    deleteReview,
} from '../controllers/reviewController.js';
import { protect, restrictTo } from '../controllers/authController.js';

const router = express.Router();

// Apply authentication middleware to all review routes
router.use(protect);

// --- Main Routes ---
router
    .route('/')
    .get(getAllReviews) // Anyone logged in can GET reviews (with optional filters)
    .post(restrictTo('provider'), createReview); // Only Providers can POST (create) reviews

// --- Routes for Specific Review ID ---
router
    .route('/:id')
    .get(getReview) // Anyone logged in can GET a specific review
    .patch(restrictTo('provider', 'admin'), updateReview) // Only original reviewer or admin can PATCH (update)
    .delete(restrictTo('provider', 'admin'), deleteReview); // Only original reviewer or admin can DELETE

// --- Optional: Nested Routes (If you prefer) ---
// You could also mount this router under gigs or users, e.g.,
// gigRouter.use('/:gigId/reviews', reviewRouter);
// userRouter.use('/:userId/reviews', reviewRouter); // Requires adjustments in controller (setGigUserIds middleware)

export default router;