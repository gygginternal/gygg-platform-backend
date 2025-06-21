import mongoose from 'mongoose';
import Review from '../models/Review.js';
import Contract from '../models/Contract.js';
import AppError from '../utils/AppError.js';
import catchAsync from '../utils/catchAsync.js';
import Notification from '../models/Notification.js';
import logger from '../utils/logger.js';
import notifyAdmin from '../utils/notifyAdmin.js';

/**
 * @desc Create a review (only by Provider after contract completion)
 * @route POST /api/v1/reviews
 * @access Private (Provider only)
 */
export const createReview = catchAsync(async (req, res, next) => {
    const { rating, comment, contract } = req.body;
    const reviewerId = req.user.id;

    // Validate input
    if (!rating || !contract) {
        return next(new AppError('Please provide a rating and the contract ID.', 400));
    }
    if (!mongoose.Types.ObjectId.isValid(contract)) {
        return next(new AppError('Invalid Contract ID format.', 400));
    }

    // Find and validate contract
    const contractDoc = await Contract.findById(contract).select('provider tasker status gig');
    if (!contractDoc) {
        return next(new AppError('Contract not found.', 404));
    }
    if (!contractDoc.provider.equals(reviewerId)) {
        return next(new AppError('Only the provider can leave a review for this contract.', 403));
    }
    if (contractDoc.status !== 'completed') {
        return next(new AppError('Reviews can only be left for completed contracts.', 400));
    }

    // Prevent duplicate reviews
    const existingReview = await Review.findOne({ contract });
    if (existingReview) {
        return next(new AppError('A review has already been submitted for this contract.', 400));
    }

    // Create and return review
    const newReview = await Review.create({
        contract,
        gig: contractDoc.gig,
        reviewer: reviewerId,
        reviewee: contractDoc.tasker,
        rating,
        comment,
    });

    await newReview.populate('reviewer', 'firstName lastName profileImage');

    res.status(201).json({
        status: 'success',
        data: { review: newReview },
    });
});

/**
 * @desc Get all reviews (filterable by gig, tasker, or provider)
 * @route GET /api/v1/reviews
 * @access Public
 */
export const getAllReviews = catchAsync(async (req, res, next) => {
    const filter = {};
    if (req.query.gigId) filter.gig = req.query.gigId;
    if (req.query.taskerId) filter.reviewee = req.query.taskerId;
    if (req.query.providerId) filter.reviewer = req.query.providerId;

    const reviews = await Review.find(filter)
        .populate('reviewer', 'firstName lastName profileImage')
        .populate('reviewee', 'firstName lastName profileImage')
        .populate('gig', 'title')
        .sort({ createdAt: -1 });

    res.status(200).json({
        status: 'success',
        results: reviews.length,
        data: { reviews },
    });
});

/**
 * @desc Get single review by ID
 * @route GET /api/v1/reviews/:id
 * @access Public
 */
export const getReview = catchAsync(async (req, res, next) => {
    const review = await Review.findById(req.params.id)
        .populate('reviewer', 'firstName lastName profileImage')
        .populate('reviewee', 'firstName lastName profileImage')
        .populate('gig', 'title category');

    if (!review) {
        return next(new AppError('No review found with that ID.', 404));
    }

    res.status(200).json({
        status: 'success',
        data: { review },
    });
});

/**
 * @desc Update a review (only by original reviewer)
 * @route PATCH /api/v1/reviews/:id
 * @access Private (Reviewer only)
 */
export const updateReview = catchAsync(async (req, res, next) => {
    const { rating, comment, contract } = req.body;
    const reviewId = req.params.id;
    const userId = req.user.id;

    // Prevent changing the contract field
    if (contract !== undefined) {
        return next(new AppError('Contract field cannot be modified.', 400));
    }

    const review = await Review.findById(reviewId);
    if (!review) {
        return next(new AppError('No review found with that ID.', 404));
    }
    if (!review.reviewer.equals(userId)) {
        return next(new AppError('You can only update your own reviews.', 403));
    }

    // Update fields if provided
    if (rating !== undefined) review.rating = rating;
    if (comment !== undefined) review.comment = comment;

    const updatedReview = await review.save();
    await updatedReview.populate('reviewer', 'firstName lastName profileImage');

    res.status(200).json({
        status: 'success',
        data: { review: updatedReview },
    });
});

/**
 * @desc Delete a review (by reviewer or admin)
 * @route DELETE /api/v1/reviews/:id
 * @access Private (Reviewer or Admin)
 */
export const deleteReview = catchAsync(async (req, res, next) => {
    const reviewId = req.params.id;
    const review = await Review.findById(reviewId);
    if (!review) return next(new AppError('No review found with that ID', 404));
    
    // Only the original reviewer or admin can delete
    if (!review.reviewer.equals(req.user.id) && !req.user.role.includes('admin')) {
        return next(new AppError('You do not have permission to delete this review.', 403));
    }
    
    // Cascade delete related notifications
    await Notification.deleteMany({ 'data.reviewId': reviewId });
    await Review.findByIdAndDelete(reviewId);
    logger.warn(`Review ${reviewId} deleted by user ${req.user.id}`);
    await notifyAdmin('Review deleted', { reviewId, deletedBy: req.user.id });
    res.status(204).json({ status: 'success', data: null });
});

// Get reviews for a specific user (reviewee)
export const getReviewsByUserId = catchAsync(async (req, res, next) => {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
        return next(new AppError('No reviews found for this user.', 404));
    }
    const reviews = await Review.find({ reviewee: userId })
        .populate('reviewer', 'firstName lastName profileImage')
        .populate('gig', 'title')
        .sort({ createdAt: -1 });
    if (!reviews || reviews.length === 0) {
        return next(new AppError('No reviews found for this user.', 404));
    }
    const reviewsWithRevieweeId = reviews.map(r => {
        const obj = r.toObject();
        obj.reviewee = String(userId);
        return obj;
    });
    res.status(200).json({
        status: 'success',
        data: { reviews: reviewsWithRevieweeId },
    });
});

// Get average rating for a user (reviewee)
export const getAverageRatingByUserId = catchAsync(async (req, res, next) => {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
        return next(new AppError('No reviews found for this user.', 404));
    }
    const result = await Review.aggregate([
        { $match: { reviewee: new mongoose.Types.ObjectId(userId) } },
        {
            $group: {
                _id: '$reviewee',
                averageRating: { $avg: '$rating' },
                reviewCount: { $sum: 1 },
            },
        },
    ]);
    if (!result || result.length === 0) {
        return next(new AppError('No reviews found for this user.', 404));
    }
    res.status(200).json({
        status: 'success',
        data: {
            averageRating: result[0].averageRating,
            reviewCount: result[0].reviewCount,
        },
    });
});
