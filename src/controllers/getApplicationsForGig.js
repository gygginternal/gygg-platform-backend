import mongoose from 'mongoose';
import { Gig } from '../models/Gig.js';
import Application from '../models/Application.js';
import User from '../models/User.js';
import catchAsync from '../utils/catchAsync.js';
import AppError from '../utils/AppError.js';
import logger from '../utils/logger.js';

// ... (previous functions in the file)

// Get all applications for a specific gig
export const getApplicationsForGig = catchAsync(async (req, res, next) => {
  const { gigId } = req.params;
  
  // Validate gig ID
  if (!mongoose.Types.ObjectId.isValid(gigId)) {
    return next(new AppError('Invalid Gig ID format', 400));
  }
  
  // Find the gig
  const gig = await Gig.findById(gigId);
  if (!gig) {
    return next(new AppError('Gig not found', 404));
  }
  
  // Check if user is authorized to view applications (must be the gig provider)
  if (gig.postedBy.toString() !== req.user.id) {
    return next(new AppError('Not authorized to view applications for this gig', 403));
  }
  
  // Get all applications for this gig, sorted by creation date
  const applications = await Application.find({ gig: gigId })
    .populate('user', 'firstName lastName email profileImage')
    .sort({ createdAt: -1 });
  
  logger.info(`getApplicationsForGig: Retrieved ${applications.length} applications for gig ${gigId}`);
  
  res.status(200).json({
    status: 'success',
    results: applications.length,
    data: {
      applications
    }
  });
});