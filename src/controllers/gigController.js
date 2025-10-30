import mongoose from "mongoose";
import AppError from "../utils/AppError.js";
import catchAsync from "../utils/catchAsync.js";
import logger from "../utils/logger.js";
import User from "../models/User.js"; // Imported for matchGigsForTasker
import Application from "../models/Application.js"; // Assuming Application is the model for applications
import Notification from '../models/Notification.js';
import Payment from '../models/Payment.js';
import { Gig } from '../models/Gig.js';
import Contract from '../models/Contract.js';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import Post from '../models/Post.js';
import Review from '../models/Review.js';
import notifyAdmin from '../utils/notifyAdmin.js';

const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

async function deleteS3Attachments(attachments) {
  if (!attachments || !Array.isArray(attachments)) return;
  for (const url of attachments) {
    // Extract S3 key from URL (assuming standard S3 URL structure)
    const key = url.split('.amazonaws.com/')[1];
    if (key) {
      try {
        await s3Client.send(new DeleteObjectCommand({
          Bucket: process.env.AWS_S3_BUCKET_NAME,
          Key: key,
        }));
      } catch (err) {
        logger.error('Failed to delete S3 attachment', { key, err });
      }
    }
  }
}

export const getMyApplicationForGig = catchAsync(async (req, res, next) => {
  const { gigId } = req.params;
  const userId = req.user._id; // Get the logged-in user's ID

  // Find the user's application for the specified gig
  const application = await Application.findOne({
    gig: gigId,
    user: userId,
  }).populate("gig");

  if (!application) {
    return res.status(200).json({
      status: "success",
      data: null, // Return null if no application exists
    });
  }

  // Format the response to include gig details
  const formattedApplication = {
    id: application._id,
    gigTitle: application.gig.title,
    gigCategory: application.gig.category,
    gigCost: application.gig.cost,
    gigStatus: application.gig.status,
    applicationStatus: application.status,
    createdAt: application.createdAt,
  };
  console.log({ formattedApplication });

  res.status(200).json({
    status: "success",
    data: formattedApplication,
  });
});

/**
 * Checks if the user has ownership or admin privileges.
 */
const checkOwnershipOrAdmin = (resourceUserId, requestingUser) => {
  // Ensure resourceUserId is not null or undefined before calling toString
  if (!resourceUserId) {
    logger.warn("checkOwnershipOrAdmin: resourceUserId is null or undefined.");
    throw new AppError("Resource owner information is missing.", 500); // Or 403 if appropriate
  }
  if (
    resourceUserId.toString() !== requestingUser.id &&
    !requestingUser.role.includes("admin")
  ) {
    throw new AppError(
      "You do not have permission to perform this action",
      403
    );
  }
  return true;
};

/**
 * Get all gigs with optional filtering, sorting, pagination, and text search.
 * @route GET /api/v1/gigs
 * @access Public (or Protected, depending on your protect middleware placement in routes)
 */
export const getAllGigs = catchAsync(async (req, res, next) => {
  // Use aggregation pipeline for more efficient filtering and pagination
  const pipeline = [];
  
  // Base match conditions
  const matchConditions = {};
  
  // --- Handle Status Filter ---
  matchConditions.status = req.query.status || "open";
  
  // --- Handle Text Search ---
  if (req.query.search && req.query.search.trim() !== "") {
    const searchTerm = req.query.search.trim();
    matchConditions.$text = { $search: searchTerm };
    logger.debug(`getAllGigs: Applying text search for term: "${searchTerm}"`);
    
    // Add text score for sorting
    pipeline.push({ 
      $addFields: { 
        score: { $meta: "textScore" } 
      } 
    });
  }
  
  // --- Handle Category Filter ---
  if (req.query.category && req.query.category !== "All") {
    matchConditions.category = req.query.category;
    logger.debug(`getAllGigs: Filtering by category: "${req.query.category}"`);
  }
  
  // --- Handle Location Filter ---
  if (req.query.location && req.query.location.trim() !== "") {
    const locationTerm = req.query.location.trim();
    const locationRegex = new RegExp(locationTerm, 'i');
    
    // Debug the location structure in the database
    const sampleGig = await Gig.findOne({ location: { $exists: true } }).lean();
    logger.debug(`getAllGigs: Sample gig location structure: ${JSON.stringify(sampleGig?.location || 'No gigs with location found')}`);
    
    matchConditions.$or = [
      { 'location.city': locationRegex },
      { 'location.state': locationRegex },
      { 'location.country': locationRegex },
      { 'location.address': locationRegex },
      { 'location.postalCode': locationRegex }
    ];
    logger.debug(`getAllGigs: Filtering by location: "${locationTerm}" with query: ${JSON.stringify(matchConditions.$or)}`);
  }
  
  // --- Handle Price Range Filter ---
  if (req.query.minPrice || req.query.maxPrice) {
    matchConditions.cost = {};
    if (req.query.minPrice) {
      matchConditions.cost.$gte = parseFloat(req.query.minPrice);
    }
    if (req.query.maxPrice) {
      matchConditions.cost.$lte = parseFloat(req.query.maxPrice);
    }
    logger.debug(`getAllGigs: Filtering by price range: ${req.query.minPrice || '0'} - ${req.query.maxPrice || '∞'}`);
  }
  
  // --- Handle Remote Filter ---
  if (req.query.isRemote !== undefined) {
    matchConditions.isRemote = req.query.isRemote === "true";
  }
  
  // Add match stage to pipeline
  pipeline.push({ $match: matchConditions });
  
  // Join with users collection to get provider info
  // Note: We need to explicitly project stripeChargesEnabled since it has select: false in the model
  pipeline.push({
    $lookup: {
      from: "users",
      localField: "postedBy",
      foreignField: "_id",
      as: "providerInfo",
      pipeline: [
        {
          $project: {
            _id: 1,
            firstName: 1,
            lastName: 1,
            fullName: { $concat: ["$firstName", " ", "$lastName"] },
            profileImage: 1,
            rating: 1,
            peoplePreference: 1,
            hobbies: 1,
            stripeAccountId: 1,
            stripeChargesEnabled: 1,
            stripePayoutsEnabled: 1
          }
        }
      ]
    }
  });
  
  pipeline.push({ $unwind: "$providerInfo" });
  
  // Sort by text score (if search was performed) and then by creation date
  if (req.query.search && req.query.search.trim() !== "") {
    pipeline.push({ $sort: { score: { $meta: "textScore" }, createdAt: -1 } });
  } else {
    pipeline.push({ $sort: { createdAt: -1 } });
  }
  
  // Count total results for pagination
  const countPipeline = [...pipeline];
  countPipeline.push({ $count: "total" });
  const countResult = await Gig.aggregate(countPipeline);
  const total = countResult.length > 0 ? countResult[0].total : 0;
  
  // Apply pagination
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const skip = (page - 1) * limit;
  
  pipeline.push({ $skip: skip });
  pipeline.push({ $limit: limit });
  
  // Project the final result to map providerInfo back to postedBy
  pipeline.push({
    $project: {
      _id: 1,
      title: 1,
      description: 1,
      category: 1,
      subcategory: 1,
      cost: 1,
      ratePerHour: 1,
      isHourly: 1,
      estimatedHours: 1,
      location: 1,
      isRemote: 1,
      deadline: 1,
      duration: 1,
      skills: 1,
      status: 1,
      attachments: 1,
      createdAt: 1,
      updatedAt: 1,
      postedBy: "$providerInfo" // Map providerInfo back to postedBy
    }
  });
  
  // Execute the query
  const gigs = await Gig.aggregate(pipeline);
  logger.debug(`getAllGigs: Found ${gigs.length} gigs out of ${total} total matches`);
  
  res.status(200).json({
    status: 'success',
    results: gigs.length,
    data: { gigs },
    total,
    page,
    totalPages: Math.ceil(total / limit)
  });
});

/**
 * Get a single gig by its ID.
 */
export const getGig = catchAsync(async (req, res, next) => {
  logger.debug(`getGig: Fetching gig with ID: ${req.params.id}`);
  const gig = await Gig.findById(req.params.id); // Population handled by pre-find hook
  if (!gig) return next(new AppError("No gig found with that ID", 404));

  res.status(200).json({ status: "success", data: { gig } });
});

/**
 * Create a new gig.
 */
export const createGig = catchAsync(async (req, res, next) => {
  // Debug: Log the entire request body to see what's being received
  logger.info(`createGig: Full request body received:`, JSON.stringify(req.body, null, 2));
  
  const {
    title,
    description,
    category,
    subcategory,
    cost,
    ratePerHour,
    isHourly,
    estimatedHours,
    location,
    isRemote,
    deadline,
    duration,
    skills,
  } = req.body;
  
  logger.info(
    `createGig: User ${req.user.id} creating ${isHourly ? 'hourly' : 'fixed'} gig with title: "${title}"`
  );
  logger.info(`createGig: isHourly=${isHourly} (type: ${typeof isHourly}), cost=${cost}, ratePerHour=${ratePerHour}`);

  // Validate payment type specific fields
  if (isHourly === true || isHourly === 'true') {
    logger.info(`createGig: Validating hourly gig - ratePerHour: ${ratePerHour}`);
    if (!ratePerHour || parseFloat(ratePerHour) <= 0) {
      return next(new AppError('Hourly rate is required and must be greater than 0 for hourly gigs', 400));
    }
  } else {
    logger.info(`createGig: Validating fixed gig - cost: ${cost}`);
    if (!cost || parseFloat(cost) <= 0) {
      return next(new AppError('Cost is required and must be greater than 0 for fixed gigs', 400));
    }
  }

  const newGigData = {
    title,
    description,
    category,
    subcategory,
    location,
    isRemote,
    deadline,
    skills,
    postedBy: req.user.id, // Set the poster from the authenticated user
    status: "open",
    isHourly: Boolean(isHourly),
  };

  // Set payment fields based on gig type
  if (isHourly) {
    newGigData.ratePerHour = parseFloat(ratePerHour);
    if (estimatedHours) {
      newGigData.estimatedHours = parseFloat(estimatedHours);
    }
    // For duration field compatibility (some parts of system might expect it)
    newGigData.duration = estimatedHours ? parseFloat(estimatedHours) : duration;
  } else {
    newGigData.cost = parseFloat(cost);
    newGigData.duration = duration;
  }

  const newGig = await Gig.create(newGigData);
  logger.info(`createGig: ${isHourly ? 'Hourly' : 'Fixed'} gig ${newGig._id} created successfully. ${isHourly ? `Rate: $${ratePerHour}/hr` : `Cost: $${cost}`}`);

  res.status(201).json({ status: "success", data: { gig: newGig } });
});

/**
 * Update a gig by its ID.
 */
export const updateGig = catchAsync(async (req, res, next) => {
  const gigId = req.params.id;
  logger.debug(
    `updateGig: User ${req.user.id} attempting to update gig ID: ${gigId}`
  );

  const gig = await Gig.findById(gigId);
  if (!gig) return next(new AppError("No gig found with that ID", 404));

  checkOwnershipOrAdmin(gig.postedBy._id, req.user); // Pass postedBy ID

  const allowedFields = [
    "title",
    "description",
    "category",
    "subcategory",
    "cost",
    "location",
    "isRemote",
    "deadline",
    "duration",
    "skills",
  ];
  const updates = {};
  allowedFields.forEach((field) => {
    if (req.body[field] !== undefined) {
      updates[field] = req.body[field];
    }
  });

  if (Object.keys(updates).length === 0) {
    return next(new AppError("No valid fields provided for update.", 400));
  }
  // Add checks here to prevent updates if gig status is 'assigned', 'completed', etc.
  // if (['assigned', 'active', 'completed'].includes(gig.status) && (updates.cost || updates.deadline)) {
  //    return next(new AppError('Cannot update critical fields for an active or completed gig.', 400));
  // }

  logger.debug(`updateGig: Updating gig ${gigId} with data:`, updates);
  const updatedGig = await Gig.findByIdAndUpdate(gigId, updates, {
    new: true,
    runValidators: true,
  });
  logger.info(`updateGig: Gig ${gigId} updated successfully.`);

  res.status(200).json({ status: "success", data: { gig: updatedGig } });
});

/**
 * Delete a gig by its ID.
 */
export const deleteGig = catchAsync(async (req, res, next) => {
  const gigId = req.params.id;
  logger.warn(
    `deleteGig: User ${req.user.id} attempting to delete gig ID: ${gigId}`
  );

  const gig = await Gig.findById(gigId);
  if (!gig) return next(new AppError("No gig found with that ID", 404));

  checkOwnershipOrAdmin(gig.postedBy._id, req.user); // Pass postedBy ID

  // Prevent deletion if contracts exist
  const contractCount = await Contract.countDocuments({ gig: gigId });
  if (contractCount > 0) {
    return next(new AppError('Cannot delete gig with existing contracts. Cancel contracts first.', 400));
  }

  // Prevent deletion if payments exist
  const paymentCount = await Payment.countDocuments({ gig: gigId });
  if (paymentCount > 0) {
    return next(new AppError('Cannot delete gig with existing payments. Refund/cancel payments first.', 400));
  }

  // Only allow deletion if it's 'open' or 'cancelled'
  if (!["open", "cancelled"].includes(gig.status)) {
    return next(
      new AppError(
        `Cannot delete gig with status '${gig.status}'. Consider cancelling it first.`,
        400
      )
    );
  }

  // Delete related attachments from S3 if any
  if (gig.attachments && gig.attachments.length > 0) {
    await deleteS3Attachments(gig.attachments);
  }

  // Cascade delete related records
  await Promise.all([
    Contract.deleteMany({ gig: gigId }),
    Payment.deleteMany({ gig: gigId }),
    Application.deleteMany({ gig: gigId }),
    Review.deleteMany({ gig: gigId }),
    Notification.deleteMany({ 'data.gigId': gigId }),
    Post.deleteMany({ 'data.gigId': gigId }),
  ]);

  await Gig.findByIdAndDelete(gigId);
  logger.warn(`Gig ${gigId} and all related data deleted by user ${req.user.id}.`);
  await notifyAdmin('Gig deleted', { gigId, deletedBy: req.user.id });

  res.status(204).json({ status: "success", data: null });
});

// Helper to send notification
async function sendNotification({ user, type, message, data, icon }) {
  try {
    await Notification.create({ user, type, message, data, icon });
  } catch (err) {
    logger.error('Failed to send notification', { user, type, message, data, icon, err });
  }
}

// --- Handler: User applies to a gig (application creation) ---
export const applyToGig = catchAsync(async (req, res, next) => {
  const { gigId } = req.params;
  const userId = req.user._id;
  console.log('applyToGig: gigId param:', gigId, typeof gigId);
  const gig = await Gig.findById(gigId);
  console.log('applyToGig: gig found:', gig);
  if (!gig) return next(new AppError('Gig not found', 404));

  // Check if already applied
  const existing = await Application.findOne({ gig: gigId, user: userId });
  if (existing) return next(new AppError('Already applied to this gig', 400));

  const application = await Application.create({ gig: gigId, user: userId, status: 'pending' });

  // Notify provider
  if (gig.postedBy.toString() !== userId.toString()) {
    await sendNotification({
      user: gig.postedBy,
      type: 'gig_application',
      message: `${req.user.firstName} applied to your gig: ${gig.title}`,
      data: { gigId: gig._id, applicationId: application._id },
      icon: 'applied-user',
    });
  }

  res.status(201).json({ status: 'success', data: { application } });
});

/**
 * Accept a gig and create a contract.
 */

/**
 * Match gigs for a tasker based on hobby and people preferences.
 */
export const matchGigsForTasker = catchAsync(async (req, res, next) => {
  // ... (Your existing matchGigsForTasker logic - looks good) ...
  // Ensure User model is imported if not already at the top.
  const tasker = req.user;
  const taskerHobbies = tasker.hobbies || [];
  const taskerPreference = Array.isArray(tasker.peoplePreference)
    ? tasker.peoplePreference.join(" ")
    : tasker.peoplePreference || ""; // Join if array
  const taskerId = tasker._id;

  logger.debug(
    `matchGigsForTasker: Tasker ${taskerId} searching. Hobbies: [${taskerHobbies.join(
      ", "
    )}], Pref: "${taskerPreference}"`
  );

  const pipeline = [];
  pipeline.push({ $match: { status: "open", postedBy: { $ne: taskerId } } });
  pipeline.push({
    $lookup: {
      from: "users",
      localField: "postedBy",
      foreignField: "_id",
      as: "providerInfo",
      pipeline: [
        {
          $project: {
            _id: 1,
            firstName: 1,
            lastName: 1,
            fullName: 1,
            profileImage: 1,
            rating: 1,
            peoplePreference: 1,
            hobbies: 1,
            bio: 1,
            stripeAccountId: 1,
            stripeChargesEnabled: 1,
            stripePayoutsEnabled: 1
          }
        }
      ]
    },
  });
  pipeline.push({
    $unwind: { path: "$providerInfo", preserveNullAndEmptyArrays: true },
  });

  const matchOrConditions = [];
  // Match based on tasker's preference against provider's preference or bio
  if (taskerPreference.trim()) {
    // If provider's peoplePreference is an array, check if tasker's preference string is IN that array or matches bio
    matchOrConditions.push({
      $or: [
        {
          "providerInfo.peoplePreference": {
            $regex: new RegExp(taskerPreference.trim(), "i"),
          },
        }, // If provider pref is string
        {
          "providerInfo.peoplePreference": {
            $in: [new RegExp(taskerPreference.trim(), "i")],
          },
        }, // If provider pref is array
        {
          "providerInfo.bio": {
            $regex: new RegExp(taskerPreference.trim(), "i"),
          },
        }, // Match bio also
      ],
    });
  }
  if (taskerHobbies.length > 0) {
    matchOrConditions.push({ "providerInfo.hobbies": { $in: taskerHobbies } });
  }

  if (matchOrConditions.length > 0) {
    pipeline.push({ $match: { $or: matchOrConditions } });
  } else {
    logger.info(
      `matchGigsForTasker: Tasker ${taskerId} has no specific preferences. Showing general open gigs.`
    );
  }

  pipeline.push({
    $addFields: {
      matchScore: {
        $add: [
          {
            $cond: [
              {
                $gt: [
                  {
                    $size: {
                      $ifNull: [
                        {
                          $setIntersection: [
                            "$providerInfo.hobbies",
                            taskerHobbies,
                          ],
                        },
                        [],
                      ],
                    },
                  },
                  0,
                ],
              },
              5,
              0,
            ],
          }, // Hobby match score
          // More complex score for preference based on regex match
          {
            $cond: [
              {
                $or: [
                  {
                    $regexMatch: {
                      input: "$providerInfo.peoplePreference",
                      regex: new RegExp(taskerPreference.trim(), "i"),
                    },
                  },
                  // Add $in check if providerInfo.peoplePreference is an array (requires type consistency)
                  // { $setIsSubset: [[taskerPreference], "$providerInfo.peoplePreference"] } // if tasker pref is string and provider is array
                ],
              },
              10,
              0,
            ],
          },
          { $ifNull: ["$providerInfo.rating", 0] }, // Rating bonus
        ],
      },
    },
  });

  pipeline.push({ $sort: { matchScore: -1, createdAt: -1 } });
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
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
      ratePerHour: 1,
      isHourly: 1,
      estimatedHours: 1,
      location: 1,
      isRemote: 1,
      createdAt: 1,
      status: 1,
      matchScore: 1,
      postedBy: {
        _id: "$providerInfo._id",
        firstName: "$providerInfo.firstName",
        lastName: "$providerInfo.lastName",
        fullName: { $concat: ["$providerInfo.firstName", " ", "$providerInfo.lastName"] },
        profileImage: "$providerInfo.profileImage",
        rating: "$providerInfo.rating",
        peoplePreference: "$providerInfo.peoplePreference",
        hobbies: "$providerInfo.hobbies",
      },
    },
  });

  const gigs = await Gig.aggregate(pipeline);
  logger.info(
    `matchGigsForTasker: Found ${gigs.length} gigs for tasker ${taskerId}`
  );
  // After fetching gigs with aggregate
  const gigsWithPayment = gigs.filter(gig => {
    const provider = gig.providerInfo;
    return provider && provider.stripeAccountId && provider.stripeChargesEnabled === true;
  });
  logger.info(
    `matchGigsForTasker: Found ${gigsWithPayment.length} gigs for tasker ${taskerId} (with payment method)`
  );
  res
    .status(200)
    .json({ status: "success", results: gigsWithPayment.length, data: { gigs: gigsWithPayment } });
});

export const getMyGigsWithNoApplications = catchAsync(
  async (req, res, next) => {
    const userId = req.user._id; // Logged-in user's ID
    
    // Debug logging
    logger.debug('Fetching gigs with no applications for user:', { 
      userId: userId.toString(),
      userType: typeof userId,
      userRole: req.user.role
    });

    // Find gigs posted by the user
    const gigs = await Gig.aggregate([
      {
        $match: {
          postedBy: userId, // Match gigs posted by the logged-in user
          status: "open", // Only include gigs with status "open"
        },
      },
      {
        $lookup: {
          from: "applications", // Lookup applications for the gig
          localField: "_id",
          foreignField: "gig",
          as: "applications",
        },
      },
      {
        $sort: { createdAt: -1 }, // Sort by creation date (most recent first)
      },
      {
        $project: {
          _id: "$_id", // Use MongoDB's _id as the _id
          title: 1,
          category: 1,
          cost: 1,
          isHourly: 1,
          ratePerHour: 1,
          estimatedHours: 1,
          location: {
            $cond: {
              if: { $and: [
                { $ne: ["$location.city", null] },
                { $ne: ["$location.state", null] }
              ]},
              then: { $concat: ["$location.city", ", ", "$location.state"] },
              else: {
                $cond: {
                  if: { $ne: ["$location.city", null] },
                  then: "$location.city",
                  else: {
                    $cond: {
                      if: { $ne: ["$location.state", null] },
                      then: "$location.state",
                      else: null
                    }
                  }
                }
              }
            }
          },
          description: 1,
          createdAt: 1,
          applicationCount: { $size: "$applications" }, // Add application count
        },
      },
    ]);

    res.status(200).json({
      status: "success",
      results: gigs.length,
      data: {
        gigs,
      },
    });
  }
);


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
  // Use consistent ID comparison - normalize both IDs to strings for comparison
  const gigProviderId = gig.postedBy.toString();
  
  // Get user ID in consistent format (normalize to string)
  let currentUserId;
  if (req.user._id) {
    // If _id exists, use it (typically an ObjectId)
    currentUserId = req.user._id.toString();
  } else if (req.user.id) {
    // If only id exists, use it (typically a string)
    currentUserId = req.user.id.toString();
  } else {
    logger.error('User object missing both _id and id fields:', req.user);
    return next(new AppError('User authentication data is corrupt', 500));
  }
  
  // Normalize both IDs to ensure consistent comparison
  const normalizedGigProviderId = gigProviderId.toLowerCase();
  const normalizedCurrentUserId = currentUserId.toLowerCase();
  
  // Detailed debug logging to see exactly what's happening
  logger.debug('Authorization check for gig applications:', {
    gigId: gig._id,
    gigProviderId: gigProviderId,
    currentUserId: currentUserId,
    normalizedGigProviderId: normalizedGigProviderId,
    normalizedCurrentUserId: normalizedCurrentUserId,
    idsMatch: gigProviderId === currentUserId,
    normalizedIdsMatch: normalizedGigProviderId === normalizedCurrentUserId,
    reqUserObject: {
      _id: req.user._id,
      id: req.user.id,
      role: req.user.role,
    }
  });
  
  // Check authorization with normalized IDs
  // TODO: Remove this temporary bypass for development/testing
  const isDevMode = process.env.NODE_ENV === 'development';
  if (isDevMode) {
    logger.warn('DEVELOPMENT MODE: Bypassing authorization check for testing');
    logger.debug('Authorization bypass details:', {
      gigId: gig._id,
      gigProviderId: gigProviderId,
      currentUserId: currentUserId,
      userRole: req.user.role,
    });
  } else if (normalizedGigProviderId !== normalizedCurrentUserId) {
    logger.warn(`Unauthorized access attempt to gig applications:`, {
      gigId: gig._id,
      gigProviderId: gigProviderId,
      currentUserId: currentUserId,
      userRole: req.user.role,
      normalizedGigProviderId: normalizedGigProviderId,
      normalizedCurrentUserId: normalizedCurrentUserId,
    });
    return next(new AppError('Not authorized to view applications for this gig', 403));
  }
  
  // Log successful authorization
  if (!isDevMode) {
    logger.debug('Authorization successful for gig applications:', {
      gigId: gig._id,
      gigProviderId: gigProviderId,
      currentUserId: currentUserId,
      userRole: req.user.role,
    });
  } else {
    logger.debug('DEVELOPMENT MODE: Authorization check bypassed for gig applications:', {
      gigId: gig._id,
      gigProviderId: gigProviderId,
      currentUserId: currentUserId,
      userRole: req.user.role,
    });
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
