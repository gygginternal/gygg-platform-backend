import mongoose from 'mongoose';
import { Gig } from '../models/Gig.js';
import Contract from '../models/Contract.js';
import AppError from '../utils/AppError.js';
import catchAsync from '../utils/catchAsync.js';
import logger from '../utils/logger.js'

/**
 * Checks if the user has ownership or admin privileges.
 * @param {string} resourceUserId - ID of the resource's owner.
 * @param {Object} requestingUser - The currently logged-in user.
 * @throws {AppError} Throws an error if the user lacks permissions.
 * @returns {boolean} True if authorized.
 */
const checkOwnershipOrAdmin = (resourceUserId, requestingUser) => {
  if (resourceUserId.toString() !== requestingUser.id && !requestingUser.role.includes('admin')) {
    throw new AppError('You do not have permission to perform this action', 403);
  }
  return true;
};

/**
 * Get all gigs with optional filtering, sorting, and pagination.
 * @route GET /api/gigs
 * @access Public
 */
export const getAllGigs = catchAsync(async (req, res, next) => {
  const queryObj = { ...req.query };
  const excludedFields = ['page', 'sort', 'limit', 'fields'];
  excludedFields.forEach(el => delete queryObj[el]);

  let query = Gig.find(queryObj);

  if (req.query.sort) {
    query = query.sort(req.query.sort.split(',').join(' '));
  } else {
    query = query.sort('-createdAt');
  }

  if (req.query.fields) {
    query = query.select(req.query.fields.split(',').join(' '));
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

/**
 * Get a single gig by its ID.
 * @route GET /api/gigs/:id
 * @access Public
 */
export const getGig = catchAsync(async (req, res, next) => {
  const gig = await Gig.findById(req.params.id);
  if (!gig) return next(new AppError('No gig found with that ID', 404));

  res.status(200).json({
    status: 'success',
    data: { gig },
  });
});

/**
 * Create a new gig.
 * @route POST /api/gigs
 * @access Private (Provider)
 */
export const createGig = catchAsync(async (req, res, next) => {
  const { title, description, category, subcategory, cost, location, isRemote, deadline, duration, skills } = req.body;

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
    postedBy: req.user.id,
  });

  res.status(201).json({
    status: 'success',
    data: { gig: newGig },
  });
});

/**
 * Update a gig by its ID.
 * @route PATCH /api/gigs/:id
 * @access Private (Owner or Admin)
 */
export const updateGig = catchAsync(async (req, res, next) => {
  const gig = await Gig.findById(req.params.id);
  if (!gig) return next(new AppError('No gig found with that ID', 404));

  checkOwnershipOrAdmin(gig.postedBy, req.user);

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

/**
 * Delete a gig by its ID.
 * @route DELETE /api/gigs/:id
 * @access Private (Owner or Admin)
 */
export const deleteGig = catchAsync(async (req, res, next) => {
  const gig = await Gig.findById(req.params.id);
  if (!gig) return next(new AppError('No gig found with that ID', 404));

  checkOwnershipOrAdmin(gig.postedBy, req.user);

  if (['assigned', 'active', 'submitted', 'approved', 'completed'].includes(gig.status)) {
    return next(new AppError('Cannot delete a gig that is active or completed.', 400));
  }

  await Gig.findByIdAndDelete(req.params.id);

  res.status(204).json({
    status: 'success',
    data: null,
  });
});

/**
 * Accept a gig and create a contract.
 * @route POST /api/gigs/:id/accept
 * @access Private (Tasker)
 */
export const acceptGig = catchAsync(async (req, res, next) => {
  const gigId = req.params.id;
  const taskerId = req.user.id;

  const gig = await Gig.findById(gigId).populate('postedBy', 'id'); // Populate provider for contract
  if (!gig) {
      logger.warn(`Accept Gig attempt: Gig not found with ID ${gigId}`);
      return next(new AppError('Gig not found', 404));
  }
  if (gig.status !== 'open') {
      logger.warn(`Accept Gig attempt: Gig ${gigId} is not open, status is ${gig.status}`);
      return next(new AppError('Gig is no longer available', 400));
  }
  if (gig.postedBy.id === taskerId) {
      logger.warn(`Accept Gig attempt: Tasker ${taskerId} tried to accept own Gig ${gigId}`);
      return next(new AppError('You cannot accept your own gig', 400));
  }

  // --- NO TRANSACTION ---
  try {
      // 1. Update Gig status and assign tasker
      gig.assignedTo = taskerId;
      gig.status = 'pending_payment'; // Or 'active' if payment is not an immediate prerequisite before contract forms
      await gig.save(); // No session needed
      logger.info(`Gig ${gigId} updated to pending_payment, assigned to Tasker ${taskerId}`);

      // 2. Create the Contract document
      const newContract = await Contract.create({
          gig: gigId,
          provider: gig.postedBy.id,
          tasker: taskerId,
          agreedCost: gig.cost,
          status: 'pending_payment' // Initial contract status
      });
      logger.info(`Contract ${newContract._id} created for Gig ${gigId}`);

      // Re-fetch gig to include the populated assignedTo for the response
      const updatedGigWithPopulatedTasker = await Gig.findById(gigId);

      res.status(200).json({
          status: 'success',
          message: 'Gig accepted successfully. Contract created, awaiting payment.',
          data: {
               contractId: newContract._id,
               gig: updatedGigWithPopulatedTasker // Send the gig with populated tasker
          }
      });

  } catch (error) {
      logger.error('--- ACCEPT GIG FAILED (NO TRANSACTION) ---', {
          errorMessage: error.message,
          errorStack: error.stack,
          gigId: gigId,
          taskerId: taskerId
      });
      // Attempt to revert gig status if contract creation failed
      // This is best-effort and might not always be possible or clean
      const originalGig = await Gig.findById(gigId);
      if (originalGig && originalGig.assignedTo && originalGig.assignedTo.equals(taskerId)) {
          logger.warn(`Attempting to revert Gig ${gigId} status due to contract creation failure.`);
          originalGig.assignedTo = null;
          originalGig.status = 'open';
          try {
              await originalGig.save();
              logger.info(`Gig ${gigId} status successfully reverted to open.`);
          } catch (revertError) {
              logger.error(`Failed to revert Gig ${gigId} status. Manual intervention may be needed.`, { revertError });
          }
      }
      return next(new AppError('Failed to accept gig. Please try again.', 500));
  }
  // --- END NO TRANSACTION ---
});

/**
 * Match gigs for a tasker based on hobby and people preferences.
 * @route GET /api/gigs/match
 * @access Private (Tasker)
 */
export const matchGigsForTasker = catchAsync(async (req, res, next) => {
  const tasker = req.user;
  const taskerHobbies = tasker.hobbies || [];
  const taskerPreference = tasker.peoplePreference || '';
  const taskerId = tasker._id;

  const pipeline = [
    { $match: { status: 'open', postedBy: { $ne: taskerId } } },
    { $lookup: { from: 'users', localField: 'postedBy', foreignField: '_id', as: 'providerInfo' } },
    { $unwind: { path: '$providerInfo', preserveNullAndEmptyArrays: true } }
  ];

  const matchOrConditions = [];
  if (taskerPreference.trim()) {
    matchOrConditions.push({ 'providerInfo.peoplePreference': { $regex: new RegExp(taskerPreference.trim(), 'i') } });
  }
  if (taskerHobbies.length > 0) {
    matchOrConditions.push({ 'providerInfo.hobbies': { $in: taskerHobbies } });
  }
  if (matchOrConditions.length > 0) {
    pipeline.push({ $match: { $or: matchOrConditions } });
  }

  pipeline.push({
    $addFields: {
      matchScore: {
        $add: [
          {
            $cond: [
              { $gt: [{ $size: { $ifNull: [{ $setIntersection: ["$providerInfo.hobbies", taskerHobbies] }, []] } }, 0] },
              5,
              0
            ]
          },
          {
            $cond: [
              { $regexMatch: { input: "$providerInfo.peoplePreference", regex: new RegExp(taskerPreference.trim(), 'i') } },
              10,
              0
            ]
          },
          { $ifNull: ["$providerInfo.rating", 0] }
        ]
      }
    }
  });

  pipeline.push({ $sort: { matchScore: -1, createdAt: -1 } });

  const page = req.query.page * 1 || 1;
  const limit = req.query.limit * 1 || 10;
  const skip = (page - 1) * limit;
  pipeline.push({ $skip: skip });
  pipeline.push({ $limit: limit });

  pipeline.push({
    $project: {
      _id: 1,
      title: 1,
      description: 1,
      category: 1,
      cost: 1,
      location: 1,
      isRemote: 1,
      createdAt: 1,
      status: 1,
      matchScore: 1
    }
  });

  const gigs = await Gig.aggregate(pipeline);

  res.status(200).json({
    status: 'success',
    results: gigs.length,
    data: { gigs },
  });
});
