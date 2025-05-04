import mongoose from 'mongoose';
import { Gig } from '../models/Gig.js';
import Contract from '../models/Contract.js'; // Import the Contract model
import AppError from '../utils/AppError.js';
import catchAsync from '../utils/catchAsync.js';
import User from '../models/User.js'; // For Matching Gigs based on hobby and personality 

// Utility function to check if the current user has ownership or is an admin
const checkOwnershipOrAdmin = (resourceUserId, requestingUser) => {
  if (resourceUserId.toString() !== requestingUser.id && !requestingUser.role.includes('admin')) {
    throw new AppError('You do not have permission to perform this action', 403); // Throw error if not authorized
  }
  return true; // Return true if the user is authorized
};

// Handler to get all gigs with filtering, sorting, and pagination
export const getAllGigs = catchAsync(async (req, res, next) => {
  // Copy query parameters to modify them without affecting the original request object
  const queryObj = { ...req.query };

  // Fields to exclude from query (pagination, sorting, etc.)
  const excludedFields = ['page', 'sort', 'limit', 'fields'];
  excludedFields.forEach(el => delete queryObj[el]);

  // Initialize query
  let query = Gig.find(queryObj);

  // Handle sorting: sort by specified fields or default to 'createdAt'
  if (req.query.sort) {
    query = query.sort(req.query.sort.split(',').join(' ')); // Join fields for sorting
  } else {
    query = query.sort('-createdAt'); // Default sorting by created date
  }

  // Handle field selection: return only specified fields or exclude '__v'
  if (req.query.fields) {
    query = query.select(req.query.fields.split(',').join(' ')); // Select specific fields
  } else {
    query = query.select('-__v'); // Default: exclude version field
  }

  // Handle pagination
  const page = req.query.page * 1 || 1;
  const limit = req.query.limit * 1 || 100;
  const skip = (page - 1) * limit;
  query = query.skip(skip).limit(limit);

  // Execute query
  const gigs = await query;

  // Return response with all gigs
  res.status(200).json({
    status: 'success',
    results: gigs.length, // Total number of gigs
    data: { gigs }, // Data containing the gigs
  });
});

// Handler to get a single gig by ID
export const getGig = catchAsync(async (req, res, next) => {
  const gig = await Gig.findById(req.params.id); // Find gig by ID

  // Check if gig exists
  if (!gig) return next(new AppError('No gig found with that ID', 404)); // Return error if not found

  // Return the gig details
  res.status(200).json({
    status: 'success',
    data: { gig }, // Data containing the gig
  });
});

// Handler to create a new gig
export const createGig = catchAsync(async (req, res, next) => {
  const { title, description, category, subcategory, cost, location, isRemote, deadline, duration, skills } = req.body;

  // Create new gig document
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
    postedBy: req.user.id, // Associate the logged-in user as the poster
  });

  // Return success response with new gig
  res.status(201).json({
    status: 'success',
    data: { gig: newGig },
  });
});

// Handler to update a gig by ID
export const updateGig = catchAsync(async (req, res, next) => {
  const gig = await Gig.findById(req.params.id); // Find gig by ID

  // Check if gig exists
  if (!gig) return next(new AppError('No gig found with that ID', 404));

  // Check if the requesting user is authorized (either owns the gig or is an admin)
  checkOwnershipOrAdmin(gig.postedBy, req.user);

  // Filter and prepare allowed updates
  const allowedUpdates = {};
  const fieldsToUpdate = ['title', 'description', 'category', 'subcategory', 'cost', 'location', 'isRemote', 'deadline', 'duration', 'skills'];
  
  // Loop through fields to update and add them to allowedUpdates if they exist in request body
  fieldsToUpdate.forEach(field => {
    if (req.body[field] !== undefined) {
      allowedUpdates[field] = req.body[field];
    }
  });

  // Update the gig document
  const updatedGig = await Gig.findByIdAndUpdate(req.params.id, allowedUpdates, { new: true, runValidators: true });

  // Return success response with updated gig
  res.status(200).json({
    status: 'success',
    data: { gig: updatedGig },
  });
});

// Handler to delete a gig by ID
export const deleteGig = catchAsync(async (req, res, next) => {
  const gig = await Gig.findById(req.params.id); // Find gig by ID

  // Check if gig exists
  if (!gig) return next(new AppError('No gig found with that ID', 404));

  // Check if the requesting user is authorized (either owns the gig or is an admin)
  checkOwnershipOrAdmin(gig.postedBy, req.user);

  // Check gig status before deleting (cannot delete if it's assigned or completed)
  if (['assigned', 'active', 'submitted', 'approved', 'completed'].includes(gig.status)) {
    return next(new AppError('Cannot delete a gig that is active or completed.', 400)); // Return error if status is inappropriate
  }

  // Delete the gig
  await Gig.findByIdAndDelete(req.params.id);

  // Return success response (no content to return)
  res.status(204).json({
    status: 'success',
    data: null,
  });
});

// Handler to accept a gig (including contract creation)
export const acceptGig = catchAsync(async (req, res, next) => {
  const gigId = req.params.id;
  const taskerId = req.user.id; // Tasker accepting the gig

  // Find the gig and populate its postedBy (provider)
  const gig = await Gig.findById(gigId).populate('postedBy', 'id');
  
  // Check if gig exists and if it's still open
  if (!gig) return next(new AppError('Gig not found', 404));
  if (gig.status !== 'open') return next(new AppError('Gig is no longer available', 400));
  
  // Check if the tasker is not the same as the provider (cannot accept their own gig)
  if (gig.postedBy.id === taskerId) return next(new AppError('You cannot accept your own gig', 400));

  // Start MongoDB session for transaction
  const session = await mongoose.startSession();
  session.startTransaction();

  let newContract;
  try {
    // Update gig status and assign tasker
    gig.assignedTo = taskerId;
    gig.status = 'pending_payment'; // Change status to pending payment
    await gig.save({ session });

    // Create contract document for the gig
    const contractData = [{
      gig: gigId,
      provider: gig.postedBy.id,
      tasker: taskerId,
      agreedCost: gig.cost,
      status: 'pending_payment' // Initial status for the contract
    }];
    
    const createdContracts = await Contract.create(contractData, { session });
    newContract = createdContracts[0]; // Get the created contract document

    // Commit the transaction
    await session.commitTransaction();
    console.log(`Contract ${newContract._id} created successfully for Gig ${gigId}.`);

  } catch (error) {
    // Abort transaction if an error occurs
    await session.abortTransaction();
    console.error('--- TRANSACTION FAILED ---');
    console.error('Original Error:', error);
    return next(new AppError('Failed to accept gig. Please try again.', 500));
  } finally {
    // End the session
    session.endSession();
  }

  // Re-fetch the gig to return the updated data (after transaction)
  const updatedGig = await Gig.findById(gigId);

  // Return success response with contract and updated gig details
  res.status(200).json({
    status: 'success',
    message: 'Gig accepted successfully. Contract created, awaiting payment.',
    data: {
      contractId: newContract._id,
      gig: updatedGig
    }
  });
});

// Matching gigs based on personality of the provider with the tasker
export const matchGigsForTasker = catchAsync(async (req, res, next) => {
  const tasker = req.user;
  const taskerHobbies = tasker.hobbies || [];
  const taskerPreference = tasker.peoplePreference || '';
  const taskerId = tasker._id;

  const pipeline = [];
  pipeline.push({ $match: { status: 'open', postedBy: { $ne: taskerId } } }); // Match open gigs not by self
  pipeline.push({ $lookup: { from: 'users', localField: 'postedBy', foreignField: '_id', as: 'providerInfo' } }); // Get provider info
  pipeline.push({ $unwind: { path: '$providerInfo', preserveNullAndEmptyArrays: true } }); // Unwind provider

  // Filter based on Provider's profile vs Tasker's preferences
  const matchOrConditions = [];
  if (taskerPreference.trim()) { matchOrConditions.push({ 'providerInfo.peoplePreference': { $regex: new RegExp(taskerPreference.trim(), 'i') } }); }
  if (taskerHobbies.length > 0) { matchOrConditions.push({ 'providerInfo.hobbies': { $in: taskerHobbies } }); }
  if (matchOrConditions.length > 0) { pipeline.push({ $match: { $or: matchOrConditions } }); }
  else { console.log(`Tasker ${taskerId} has no preferences. Showing all open gigs.`); }

  // Calculate custom match score
  pipeline.push({ $addFields: { matchScore: { $add: [ { $cond: [ { $gt: [ { $size: { $ifNull: [ { $setIntersection: ["$providerInfo.hobbies", taskerHobbies] }, [] ] } }, 0 ] }, 5, 0 ] }, { $cond: [ { $regexMatch: { input: "$providerInfo.peoplePreference", regex: new RegExp(taskerPreference.trim(), 'i') } }, 10, 0 ] }, { $ifNull: [ "$providerInfo.rating", 0 ] } ] } } });
  // Sorting
  pipeline.push({ $sort: { matchScore: -1, createdAt: -1 } });
  // Pagination
  const page = req.query.page * 1 || 1; const limit = req.query.limit * 1 || 10; const skip = (page - 1) * limit;
  pipeline.push({ $skip: skip }); pipeline.push({ $limit: limit });
  // Projection
  pipeline.push({ $project: { _id: 1, title: 1, description: 1, category: 1, cost: 1, location: 1, isRemote: 1, createdAt: 1, status: 1, matchScore: 1, providerInfo: { _id: "$providerInfo._id", firstName: "$providerInfo.firstName", lastName: "$providerInfo.lastName", fullName: "$providerInfo.fullName", profileImage: "$providerInfo.profileImage", rating: "$providerInfo.rating", peoplePreference: "$providerInfo.peoplePreference", hobbies: "$providerInfo.hobbies" } } });

  console.log('Executing Tasker->Gig Match Pipeline:', JSON.stringify(pipeline));
  const matchedGigs = await Gig.aggregate(pipeline);
  res.status(200).json({ status: 'success', results: matchedGigs.length, data: { gigs: matchedGigs } });
});