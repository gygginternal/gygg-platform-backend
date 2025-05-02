import mongoose from 'mongoose';
import Review from '../models/Review.js';
import Contract from '../models/Contract.js';
import AppError from '../utils/AppError.js';
import catchAsync from '../utils/catchAsync.js';

/**
 * @desc Create a review (only by Provider after contract completion)
 * @route POST /api/v1/reviews
 * @access Private (Provider only)
 */
export const createReview = catchAsync(async (req, res, next) => {
    const { rating, comment, contractId } = req.body;
    const reviewerId = req.user.id;

    // Validate input
    if (!rating || !contractId) {
        return next(new AppError('Please provide a rating and the contract ID.', 400));
    }
    if (!mongoose.Types.ObjectId.isValid(contractId)) {
        return next(new AppError('Invalid Contract ID format.', 400));
    }

    // Find and validate contract
    const contract = await Contract.findById(contractId).select('provider tasker status gig');
    if (!contract) {
        return next(new AppError('Contract not found.', 404));
    }
    if (!contract.provider.equals(reviewerId)) {
        return next(new AppError('Only the provider can leave a review for this contract.', 403));
    }
    if (contract.status !== 'completed') {
        return next(new AppError('Reviews can only be left for completed contracts.', 400));
    }

    // Prevent duplicate reviews
    const existingReview = await Review.findOne({ contract: contractId });
    if (existingReview) {
        return next(new AppError('A review has already been submitted for this contract.', 400));
    }

    // Create and return review
    const newReview = await Review.create({
        contract: contractId,
        gig: contract.gig,
        reviewer: reviewerId,
        reviewee: contract.tasker,
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
    const { rating, comment } = req.body;
    const reviewId = req.params.id;
    const userId = req.user.id;

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
    const userId = req.user.id;

    const review = await Review.findById(reviewId);
    if (!review) {
        return next(new AppError('No review found with that ID.', 404));
    }

    const isAdmin = req.user.role.includes('admin');
    if (!review.reviewer.equals(userId) && !isAdmin) {
        return next(new AppError('You do not have permission to delete this review.', 403));
    }

    await Review.findByIdAndDelete(reviewId); // Triggers post-remove hook

    res.status(204).json({
        status: 'success',
        data: null,
    });
});
