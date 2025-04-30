import mongoose from 'mongoose';
import { Gig } from '../models/Gig.js';
import Contract from '../models/Contract.js';
import AppError from '../utils/AppError.js';
import catchAsync from '../utils/catchAsync.js';

// --- Utility function to check ownership or admin role ---
const checkOwnershipOrAdmin = (resourceUserId, requestingUser) => {
  if (resourceUserId.toString() !== requestingUser.id && !requestingUser.role.includes('admin')) {
    throw new AppError('You do not have permission to perform this action', 403);
  }
  return true;
};

// --- Gig Route Handlers ---

// Get All Gigs
export const getAllGigs = catchAsync(async (req, res, next) => {
  const queryObj = { ...req.query };
  const excludedFields = ['page', 'sort', 'limit', 'fields'];
  excludedFields.forEach(el => delete queryObj[el]);

  let query = Gig.find(queryObj);

  if (req.query.sort) {
    const sortBy = req.query.sort.split(',').join(' ');
    query = query.sort(sortBy);
  } else {
    query = query.sort('-createdAt');
  }

  if (req.query.fields) {
    const fields = req.query.fields.split(',').join(' ');
    query = query.select(fields);
  } else {
    query = query.select('-__v');
  }

  const page = req.query.page * 1 || 1;
  const limit = req.query.limit * 1 || 100;
  const skip = (page - 1) * limit;
  query = query.skip(skip).limit(limit);

  const gigs = await query;

  res.status(200).json({
    status: 'success',
    results: gigs.length,
    data: { gigs },
  });
});

// Get Single Gig
export const getGig = catchAsync(async (req, res, next) => {
  const gig = await Gig.findById(req.params.id);

  if (!gig) return next(new AppError('No gig found with that ID', 404));

  res.status(200).json({
    status: 'success',
    data: { gig },
  });
});

// Create Gig
export const createGig = catchAsync(async (req, res, next) => {
  const { title, description, category, subcategory, cost, location, isRemote, deadline, duration, skills } = req.body;
  const postedBy = req.user.id;

  const newGig = await Gig.create({
    title,
    description,
    category,
    subcategory,
    cost,
    location,
    isRemote,
    deadline,
    duration,
    skills,
    postedBy,
  });

  res.status(201).json({
    status: 'success',
    data: { gig: newGig },
  });
});

// Update Gig
export const updateGig = catchAsync(async (req, res, next) => {
  const gig = await Gig.findById(req.params.id).populate('postedBy');

  if (!gig) return next(new AppError('No gig found with that ID', 404));

  checkOwnershipOrAdmin(gig.postedBy._id, req.user);

  const allowedUpdates = {};
  const fieldsToUpdate = ['title', 'description', 'category', 'subcategory', 'cost', 'location', 'isRemote', 'deadline', 'duration', 'skills'];

  fieldsToUpdate.forEach(field => {
    if (req.body[field] !== undefined) {
      allowedUpdates[field] = req.body[field];
    }
  });

  const updatedGig = await Gig.findByIdAndUpdate(req.params.id, allowedUpdates, {
    new: true,
    runValidators: true,
  });

  res.status(200).json({
    status: 'success',
    data: { gig: updatedGig },
  });
});

// Delete Gig
export const deleteGig = catchAsync(async (req, res, next) => {
  const gig = await Gig.findById(req.params.id);

  if (!gig) return next(new AppError('No gig found with that ID', 404));

  checkOwnershipOrAdmin(gig.postedBy, req.user);

  if (['assigned', 'in-progress', 'completed'].includes(gig.status)) {
    return next(new AppError('Cannot delete a gig that is assigned or has been worked on. Consider cancelling instead.', 400));
  }

  await Gig.findByIdAndDelete(req.params.id);

  res.status(204).json({
    status: 'success',
    data: null,
  });
});

// Accept Gig (with Contract creation and transaction)
export const acceptGig = catchAsync(async (req, res, next) => {
  const gigId = req.params.id;
  const taskerId = req.user.id;

  const gig = await Gig.findById(gigId).populate('postedBy', 'id');
  if (!gig) return next(new AppError('Gig not found', 404));
  if (gig.status !== 'open') return next(new AppError('Gig is no longer available', 400));
  if (gig.postedBy.id === taskerId) return next(new AppError('You cannot accept your own gig', 400));

  const session = await mongoose.startSession();
  session.startTransaction();

  let newContract;
  try {
    gig.assignedTo = taskerId;
    gig.status = 'assigned';
    await gig.save({ session });

    newContract = await Contract.create([{
      gig: gigId,
      provider: gig.postedBy.id,
      tasker: taskerId,
      agreedCost: gig.cost,
      status: 'pending_payment'
    }], { session });

    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();

    // --- Enhanced Logging ---
    console.error('--- TRANSACTION FAILED ---');
    console.error('Original Error:', error);
    console.error('Gig ID:', gigId);
    console.error('Tasker ID:', taskerId);
    console.error('Gig Data before save attempt:', gig.toObject ? gig.toObject() : gig);

    return next(new AppError('Failed to accept gig. Please try again.', 500));
  } finally {
    session.endSession();
  }

  res.status(200).json({
    status: 'success',
    message: 'Gig accepted successfully. Contract created.',
    data: {
      contractId: newContract[0]._id,
      gig,
    },
  });
});
