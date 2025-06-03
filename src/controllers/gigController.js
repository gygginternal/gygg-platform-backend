import mongoose from "mongoose";
import { Gig } from "../models/Gig.js"; // Assuming Gig is the default export if not using named
import Contract from "../models/Contract.js";
import AppError from "../utils/AppError.js";
import catchAsync from "../utils/catchAsync.js";
import logger from "../utils/logger.js";
import User from "../models/User.js"; // Imported for matchGigsForTasker
import Applicance from "../models/Applicance.js"; // Assuming Applicance is the model for applications

export const getMyApplicationForGig = catchAsync(async (req, res, next) => {
  const { gigId } = req.params;
  const userId = req.user._id; // Get the logged-in user's ID

  // Find the user's application for the specified gig
  const application = await Applicance.findOne({
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
  const queryObj = { ...req.query };
  const excludedFields = ["page", "sort", "limit", "fields", "search"]; // 'search' is handled separately
  excludedFields.forEach((el) => delete queryObj[el]);

  // --- Handle Text Search ---
  let sortOptions = { createdAt: -1 }; // Default sort: newest first
  let projection = {}; // For text score projection

  if (req.query.search && req.query.search.trim() !== "") {
    const searchTerm = req.query.search.trim();
    queryObj.$text = { $search: searchTerm };
    logger.debug(`getAllGigs: Applying text search for term: "${searchTerm}"`);
    // When using $text search, MongoDB can sort by relevance score
    projection.score = { $meta: "textScore" };
    sortOptions = { score: { $meta: "textScore" }, ...sortOptions }; // Sort by relevance, then by default
  }
  // --- End Text Search ---

  // --- Handle other filters (e.g., status, category) ---
  // Convert query params like 'isRemote=true' to boolean
  if (queryObj.isRemote !== undefined) {
    queryObj.isRemote = queryObj.isRemote === "true";
  }
  // Add more specific filters as needed (e.g., cost range)
  // Example: if (queryObj.minCost) queryObj.cost = { ...queryObj.cost, $gte: parseFloat(queryObj.minCost) };
  // Example: if (queryObj.maxCost) queryObj.cost = { ...queryObj.cost, $lte: parseFloat(queryObj.maxCost) };

  logger.debug(
    "getAllGigs: Final query object (excluding sort/page/limit/fields):",
    queryObj
  );
  let query = Gig.find(queryObj, projection); // Apply projection if text search is used

  // --- Sorting ---
  if (req.query.sort) {
    // If a custom sort is provided AND we are not doing a text search (or want to override its relevance sort)
    if (
      !queryObj.$text ||
      (queryObj.$text && !req.query.sort.includes("score"))
    ) {
      const sortBy = req.query.sort.split(",").join(" ");
      sortOptions = sortBy; // Mongoose sort() can take string directly
      logger.debug(`getAllGigs: Applying custom sort: "${sortBy}"`);
    }
  }
  query = query.sort(sortOptions);

  // --- Field Limiting ---
  if (req.query.fields) {
    const fields = req.query.fields.split(",").join(" ");
    query = query.select(fields);
  } else {
    query = query.select("-__v"); // Exclude __v by default
  }

  // --- Pagination ---
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10; // Default to 10 results per page
  const skip = (page - 1) * limit;
  query = query.skip(skip).limit(limit);

  // --- Execute Query ---
  const gigs = await query; // Population is handled by pre-find hook in Gig model

  // Optionally, get total count for pagination metadata
  // Create a separate count query that matches the filters (excluding pagination/sort for count)
  // This can be expensive if not optimized.
  const totalGigs = await Gig.countDocuments(queryObj);

  logger.info(
    `getAllGigs: Found ${gigs.length} gigs for page ${page} (Total matching: ${totalGigs})`
  );

  res.status(200).json({
    status: "success",
    results: gigs.length,
    total: totalGigs, // Total documents matching the filter criteria
    page: page,
    totalPages: Math.ceil(totalGigs / limit),
    data: { gigs },
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
  const {
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
  } = req.body;
  logger.info(
    `createGig: User ${req.user.id} creating gig with title: "${title}"`
  );

  const newGigData = {
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
    postedBy: req.user.id, // Set the poster from the authenticated user
  };

  const newGig = await Gig.create(newGigData);
  logger.info(`createGig: Gig ${newGig._id} created successfully.`);

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

  // Stricter check: Only allow deletion if it's 'open' or 'cancelled'
  if (!["open", "cancelled"].includes(gig.status)) {
    return next(
      new AppError(
        `Cannot delete gig with status '${gig.status}'. Consider cancelling it first.`,
        400
      )
    );
  }
  // TODO: What about associated contracts or payments if any exist for an 'open' gig?
  // Usually, if a contract exists, deletion should be blocked.

  await Gig.findByIdAndDelete(gigId);
  logger.warn(
    `deleteGig: Gig ${gigId} deleted successfully by user ${req.user.id}.`
  );
  // TODO: Delete related attachments from S3 if any.

  res.status(204).json({ status: "success", data: null });
});

/**
 * Accept a gig and create a contract.
 */
export const acceptGig = catchAsync(async (req, res, next) => {
  // ... (Your existing acceptGig logic - without transactions, as per earlier fix) ...
  // Ensure logger calls are used here too.
  const gigId = req.params.id;
  const taskerId = req.user.id;

  const gig = await Gig.findById(gigId).populate("postedBy", "id");
  if (!gig) {
    /* ... error ... */
  }
  if (gig.status !== "open") {
    /* ... error ... */
  }
  if (gig.postedBy.id === taskerId) {
    /* ... error ... */
  }

  try {
    gig.assignedTo = taskerId;
    gig.status = "pending_payment";
    await gig.save();
    logger.info(
      `Gig ${gigId} updated to pending_payment, assigned to Tasker ${taskerId}`
    );
    const newContract = await Contract.create({
      gig: gigId,
      provider: gig.postedBy.id,
      tasker: taskerId,
      agreedCost: gig.cost,
      status: "active",
    });
    logger.info(`Contract ${newContract._id} created for Gig ${gigId}`);
    const updatedGigWithPopulatedTasker = await Gig.findById(gigId);
    res.status(200).json({
      status: "success",
      message: "Gig accepted. Contract created, awaiting payment.",
      data: {
        contractId: newContract._id,
        gig: updatedGigWithPopulatedTasker,
      },
    });
  } catch (error) {
    logger.error("--- ACCEPT GIG FAILED (NO TRANSACTION) ---", {
      /* ... error details ... */
    });
    // Revert logic
    const originalGig = await Gig.findById(gigId);
    if (
      originalGig &&
      originalGig.assignedTo &&
      originalGig.assignedTo.equals(taskerId)
    ) {
      originalGig.assignedTo = null;
      originalGig.status = "open";
      try {
        await originalGig.save();
        logger.info(`Gig ${gigId} status successfully reverted.`);
      } catch (revertError) {
        logger.error(`Failed to revert Gig ${gigId} status.`, { revertError });
      }
    }
    return next(new AppError("Failed to accept gig. Please try again.", 500));
  }
});

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
      location: 1,
      isRemote: 1,
      createdAt: 1,
      status: 1,
      matchScore: 1,
      providerInfo: {
        _id: "$providerInfo._id",
        firstName: "$providerInfo.firstName",
        lastName: "$providerInfo.lastName",
        fullName: "$providerInfo.fullName",
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
  res
    .status(200)
    .json({ status: "success", results: gigs.length, data: { gigs } });
});
