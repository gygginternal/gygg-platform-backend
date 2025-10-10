import mongoose from 'mongoose';
import User from './User.js'; // Ensure extension `.js` is used for ESM import
import { sanitizeMessageContent } from "../utils/sanitizer.js";

const reviewSchema = new mongoose.Schema({
  contract: {
    type: mongoose.Schema.ObjectId,
    ref: 'Contract',
    required: [true, 'A review must be linked to a contract.'],
    unique: true
  },
  gig: {
    type: mongoose.Schema.ObjectId,
    ref: 'Gig',
    required: true
  },
  reviewer: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: [true, 'A review must have a reviewer (provider).']
  },
  reviewee: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: [true, 'A review must have a reviewee (tasker).']
  },
  rating: {
    type: Number,
    required: [true, 'A rating score is required.'],
    min: [1, 'Rating must be at least 1.'],
    max: [5, 'Rating cannot be more than 5.']
  },
  comment: {
    type: String,
    trim: true,
    maxlength: [1000, 'Review comment cannot exceed 1000 characters.']
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: { createdAt: 'createdAt', updatedAt: false }
});

// Indexes
reviewSchema.index({ reviewee: 1 });
reviewSchema.index({ reviewer: 1 });
reviewSchema.index({ gig: 1 });

// Pre-save middleware to sanitize review comment
reviewSchema.pre('save', function(next) {
  if (this.comment && typeof this.comment === 'string') {
    this.comment = sanitizeMessageContent(this.comment);
  }
  next();
});

// Static method to calculate average rating
reviewSchema.statics.calculateAverageRating = async function (taskerId) {
  const stats = await this.aggregate([
    { $match: { reviewee: taskerId } },
    {
      $group: {
        _id: '$reviewee',
        nRating: { $sum: 1 },
        avgRating: { $avg: '$rating' }
      }
    }
  ]);

  if (stats.length > 0) {
    await User.findByIdAndUpdate(taskerId, {
      rating: stats[0].avgRating.toFixed(1),
      ratingCount: stats[0].nRating
    });
  } else {
    await User.findByIdAndUpdate(taskerId, {
      rating: 0,
      ratingCount: 0
    });
  }
};

// Middleware
reviewSchema.post('save', function () {
  this.constructor.calculateAverageRating(this.reviewee);
});

reviewSchema.pre(/^findOneAnd/, async function (next) {
  this.r = await this.findOne().clone();
  next();
});

reviewSchema.post(/^findOneAnd/, async function () {
  if (this.r) {
    await this.r.constructor.calculateAverageRating(this.r.reviewee);
  }
});

reviewSchema.pre(/^find/, function (next) {
  this.populate({
    path: 'reviewer',
    select: 'firstName lastName profileImage'
  }).populate({
    path: 'reviewee',
    select: 'firstName lastName profileImage'
  });
  next();
});

const Review = mongoose.model('Review', reviewSchema);

export default Review;
