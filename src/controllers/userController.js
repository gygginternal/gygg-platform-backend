import mongoose from "mongoose";
import User from "../models/User.js";
import AppError from "../utils/AppError.js";
import catchAsync from "../utils/catchAsync.js";
import logger from "../utils/logger.js";
import { s3Client } from "../config/s3Config.js"; // Assuming s3Config exports s3Client
import { DeleteObjectCommand } from "@aws-sdk/client-s3";

// --- Utility: Filter object to only allowed fields ---
const filterObj = (obj, ...allowedFields) => {
  const newObj = {};
  Object.keys(obj).forEach((el) => {
    if (allowedFields.includes(el)) {
      if ((el === "address" || el === "availability") && typeof obj[el] === "object" && obj[el] !== null) {
        newObj[el] = { ...obj[el] };
      } else if (Array.isArray(obj[el])) {
        newObj[el] = [...obj[el]];
      } else {
        newObj[el] = obj[el];
      }
    }
  });
  return newObj;
};

const deleteS3Object = async (key) => {
    if (!key || key === 'default.jpg') {
        logger.debug(`deleteS3Object: No valid key or key is default. Key: ${key}`);
        return;
    }
    const deleteParams = { Bucket: process.env.AWS_S3_BUCKET_NAME, Key: key };
    try {
        logger.info(`deleteS3Object: Attempting to delete S3 object: ${key}`);
        await s3Client.send(new DeleteObjectCommand(deleteParams));
        logger.info(`deleteS3Object: S3 object ${key} deleted successfully.`);
    } catch (s3DeleteError) {
        logger.error(`deleteS3Object: Failed to delete S3 object ${key}`, { error: s3DeleteError });
    }
};

// --- Controller: Get the current logged-in user (sets up for getUser) ---
export const getMe = (req, res, next) => {
  req.params.id = req.user.id;
  logger.debug(`getMe: Setting params.id to ${req.user.id}`);
  next();
};

// --- Controller: Update logged-in user's data (non-password fields only) ---
export const updateMe = catchAsync(async (req, res, next) => {
  logger.debug(`updateMe: User ${req.user.id} request. Body:`, req.body, "File:", req.file ? req.file.fieldname : "No file");

  if (req.body.password || req.body.passwordConfirm) {
    return next(new AppError('This route is not for password updates. Use /updateMyPassword.', 400));
  }

  const allowedFields = [
    'firstName', 'lastName', 'phoneNo', 'bio', 'hobbies', 'skills',
    'peoplePreference', 'availability', 'ratePerHour', 'address', 'dateOfBirth',
    'isTaskerOnboardingComplete', 'isProviderOnboardingComplete' // Allow setting these on final onboarding step
  ];
  const filteredBody = {}; // Start with an empty object

  // Explicitly copy allowed fields to avoid prototype pollution and handle types
  allowedFields.forEach(field => {
        if (req.body[field] !== undefined) {
            const value = req.body[field];

            switch (field) {
                case 'address':
                case 'availability':
                    if (typeof value === 'string') {
                        try {
                            const parsedObject = JSON.parse(value);
                            // Basic check if it's an actual object after parsing
                            if (typeof parsedObject === 'object' && parsedObject !== null && !Array.isArray(parsedObject)) {
                                filteredBody[field] = parsedObject;
                            } else {
                                logger.warn(`updateMe: Field '${field}' was a string but not a valid JSON object:`, value);
                            }
                        } catch (e) {
                            logger.warn(`updateMe: Could not parse JSON string for ${field}:`, value, e.message);
                        }
                    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                        filteredBody[field] = value; // Already an object
                    } else {
                        logger.warn(`updateMe: Invalid data type for ${field}:`, value);
                    }
                    break;

                case 'hobbies':
                case 'skills':
                case 'peoplePreference': // User model defines this as an array of strings
                    if (typeof value === 'string') {
                        // If sent as a comma-separated string, split into an array
                        filteredBody[field] = value.split(',').map(item => item.trim()).filter(item => item);
                    } else if (Array.isArray(value)) {
                        // If already an array, ensure elements are trimmed strings
                        filteredBody[field] = value.map(item => String(item).trim()).filter(item => item);
                    } else if (value) { // If it's some other truthy value but not string/array
                        logger.warn(`updateMe: Invalid data type for ${field}, expected string or array:`, value);
                    }
                    // If value is empty string or empty array, it will result in empty array, which is fine
                    break;

                case 'ratePerHour':
                    const rate = parseFloat(value);
                    if (!isNaN(rate) && rate >= 0) {
                        filteredBody[field] = rate;
                    } else {
                        logger.warn(`updateMe: Invalid value for ratePerHour:`, value);
                    }
                    break;

                case 'dateOfBirth':
                    if (value) { // Only process if a value is provided
                        const dob = new Date(value); // Handles YYYY-MM-DD strings well
                        if (!isNaN(dob.getTime())) {
                            filteredBody[field] = dob;
                        } else {
                            logger.warn(`updateMe: Invalid dateOfBirth string received: ${value}`);
                        }
                    }
                    break;

                case 'isTaskerOnboardingComplete':
                case 'isProviderOnboardingComplete':
                    filteredBody[field] = String(value).toLowerCase() === 'true' || value === true;
                    break;

                default: // For simple string fields like firstName, lastName, phoneNo, bio
                    if (typeof value === 'string') {
                        filteredBody[field] = value.trim();
                    } else {
                         filteredBody[field] = value; // For other types or if already processed by multer
                    }
                    break;
            }
        }
    });


  // Handle Profile Image Upload
  if (req.file && req.file.fieldname === 'profileImage') {
    logger.info(`updateMe: Profile image received for user ${req.user.id}. Location: ${req.file.location}`);
    filteredBody.profileImage = req.file.location;
    filteredBody.profileImageKey = req.file.key;

    // Delete old S3 profile image
    const currentUserData = await User.findById(req.user.id).select('profileImageKey'); // Fetch only needed field
    if (currentUserData?.profileImageKey && currentUserData.profileImageKey !== 'default.jpg') {
      await deleteS3Object(currentUserData.profileImageKey);
    }
  }

  if (Object.keys(filteredBody).length === 0 && !req.file) {
    return next(new AppError('No valid fields provided for update.', 400));
  }

  logger.debug(`updateMe: Updating user ${req.user.id} with final data:`, filteredBody);
  const updatedUser = await User.findByIdAndUpdate(req.user.id, filteredBody, {
    new: true, runValidators: true,
  });

  if (!updatedUser) return next(new AppError('User not found after update.', 404));

  logger.info(`User profile updated successfully for ${req.user.id}`);
  res.status(200).json({ status: 'success', data: { user: updatedUser } });
});

// --- Controller: Deactivate logged-in user's account ---
export const deleteMe = catchAsync(async (req, res, next) => {
  logger.warn(`User ${req.user.id} deactivating their account.`);
  await User.findByIdAndUpdate(req.user.id, { active: false });
  res.status(204).json({ status: 'success', data: null });
});

// --- Controller: Upload album photo ---
export const uploadAlbumPhoto = catchAsync(async (req, res, next) => {
  // ... (Implementation from previous response - looks good)
  logger.debug('S3 Album photo upload file:', req.file);
  logger.debug('S3 Album photo upload body:', req.body);

  if (!req.file) return next(new AppError('No image file uploaded.', 400));
  if (!req.body.caption || req.body.caption.trim() === '') {
    logger.warn(`uploadAlbumPhoto: Missing caption. Deleting S3 object ${req.file.key} for user ${req.user.id}`);
    await deleteS3Object(req.file.key);
    return next(new AppError('Photo caption is required.', 400));
  }

  const user = await User.findById(req.user.id);
  if (!user) { await deleteS3Object(req.file.key); return next(new AppError('User not found.', 404));}

  const newPhoto = { url: req.file.location, key: req.file.key, caption: req.body.caption.trim() };
  user.album.push(newPhoto);
  await user.save({ validateBeforeSave: false });
  const addedPhoto = user.album.id(newPhoto._id) || user.album.find(p => p.key === newPhoto.key);

  logger.info(`Album photo added for user ${req.user.id}`, { photoId: addedPhoto?._id, key: newPhoto.key });
  res.status(201).json({ status: 'success', data: { photo: addedPhoto } });
});

// --- Controller: Get user album (own or another user's) ---
export const getUserAlbum = catchAsync(async (req, res, next) => {
  // ... (Implementation from previous response - looks good)
  const userIdToFetch = req.params.userId || req.user.id;
  if (!mongoose.Types.ObjectId.isValid(userIdToFetch)) return next(new AppError('Invalid user ID format.', 400));
  logger.debug(`getUserAlbum: Fetching album for user ID: ${userIdToFetch}`);
  const userWithAlbum = await User.findById(userIdToFetch).select('album firstName lastName');
  if (!userWithAlbum) return next(new AppError('User not found.', 404));
  res.status(200).json({ status: 'success', results: userWithAlbum.album.length, data: { album: userWithAlbum.album, ownerName: `${userWithAlbum.firstName} ${userWithAlbum.lastName}`.trim() } });
});

// --- Controller: Delete album photo (own photo only) ---
export const deleteAlbumPhoto = catchAsync(async (req, res, next) => {
  // ... (Implementation from previous response - looks good)
  const userId = req.user.id;
  const photoId = req.params.photoId;
  if (!mongoose.Types.ObjectId.isValid(photoId)) return next(new AppError('Invalid photo ID format.', 400));
  logger.debug(`deleteAlbumPhoto: User ${userId} attempting to delete photo ${photoId}`);
  const user = await User.findById(userId).select('album');
  if (!user) return next(new AppError('User not found.', 404));
  const photoToDelete = user.album.id(photoId);
  if (!photoToDelete) return next(new AppError('Photo not found in your album.', 404));
  if (photoToDelete.key) { await deleteS3Object(photoToDelete.key); }
  else { logger.warn(`deleteAlbumPhoto: Photo ${photoId} had no S3 key for user ${userId}.`); }
  await User.updateOne({ _id: userId }, { $pull: { album: { _id: photoId } } });
  logger.info(`Album photo ${photoId} removed from DB for user ${userId}`);
  res.status(204).json({ status: 'success', data: null });
});

// --- Controller: Match taskers (for providers) ---
export const matchTaskers = catchAsync(async (req, res, next) => {
    const provider = req.user;
    const providerHobbies = provider.hobbies || [];
    // Assuming peoplePreference in User model is an array of strings
    const providerPreferenceText = Array.isArray(provider.peoplePreference) ? provider.peoplePreference.join(' ') : (provider.peoplePreference || '');
    const providerId = provider._id;

    logger.debug(`matchTaskers: Provider ${providerId} searching. Hobbies: [${providerHobbies.join(', ')}], Pref Text: "${providerPreferenceText}"`);

    if (providerHobbies.length === 0 && !providerPreferenceText.trim()) {
        logger.info(`matchTaskers: Provider ${providerId} has no preferences. Returning top-rated.`);
        const topTaskers = await User.find({ role: 'tasker', active: true, _id: { $ne: providerId } })
            .sort({ rating: -1, ratingCount: -1 }).limit(10)
            .select('firstName lastName fullName profileImage rating ratingCount bio peoplePreference hobbies skills');
        return res.status(200).json({ status: 'success', message: 'Showing top-rated taskers.', results: topTaskers.length, data: { taskers: topTaskers }});
    }

    const pipeline = [];
    pipeline.push({ $match: { role: 'tasker', active: true, _id: { $ne: providerId } } });

    // Add text search if provider has preferences text
    if (providerPreferenceText.trim()) {
        pipeline.push({ $match: { $text: { $search: providerPreferenceText } } });
        pipeline.push({ $addFields: { textScore: { $meta: 'textScore' } } }); // Use textScore field name
    } else {
        pipeline.push({ $addFields: { textScore: 0 } }); // Default score if no text search
    }

    // Additional filtering or scoring based on hobbies
    // This $addFields will overwrite textScore if no preferenceText was provided, which is fine.
    // If both exist, we'll sort by textScore first.
    pipeline.push({
        $addFields: {
            hobbyMatchScore: {
                $cond: [ { $gt: [ { $size: { $ifNull: [ { $setIntersection: ["$hobbies", providerHobbies] }, [] ] } }, 0 ] }, 1, 0 ]
            }
        }
    });

    // Sorting: Prioritize text match, then hobby match, then rating
    pipeline.push({ $sort: { textScore: -1, hobbyMatchScore: -1, rating: -1, ratingCount: -1 } });

    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const skip = (page - 1) * limit;
    pipeline.push({ $skip: skip }); pipeline.push({ $limit: limit });

    pipeline.push({ $project: {
        _id: 1, firstName: 1, lastName: 1, fullName: 1, profileImage: 1,
        rating: 1, ratingCount: 1, bio: 1, peoplePreference: 1, hobbies: 1, skills: 1, role: 1,
        score: "$textScore", // Alias textScore to score if preferred for consistency
        hobbyMatchScore: 1 // Include hobby match score for inspection
    }});

    const matchedTaskers = await User.aggregate(pipeline);
    logger.info(`matchTaskers: Found ${matchedTaskers.length} taskers for provider ${providerId}.`);
    res.status(200).json({ status: 'success', results: matchedTaskers.length, data: { taskers: matchedTaskers } });
});

// --- ADMIN CONTROLLERS ---

// Get All Users (Admin)
export const getAllUsers = catchAsync(async (req, res, next) => {
  logger.debug("Admin: Fetching all users", { query: req.query });
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const skip = (page - 1) * limit;

  const users = await User.find().skip(skip).limit(limit);
  const totalUsers = await User.countDocuments();

  res.status(200).json({
    status: "success",
    results: users.length,
    total: totalUsers,
    page: page,
    totalPages: Math.ceil(totalUsers / limit),
    data: { users },
  });
});

// Get Single User (Admin or used by getMe)
export const getUser = catchAsync(async (req, res, next) => {
  const userIdToFind = req.params.id; // ID comes from the route parameter (:id)
  // Validation for userIdToFind format is done by express-validator in routes
  logger.debug(`Fetching user data for ID: ${userIdToFind}`);
  const user = await User.findById(userIdToFind);
  if (!user) {
    return next(new AppError("No user found with that ID", 404));
  }
  res.status(200).json({
    status: "success",
    data: { user },
  });
});

// Update User by Admin
export const updateUser = catchAsync(async (req, res, next) => {
  const userIdToUpdate = req.params.id;
  // Validation for userIdToUpdate format is done by express-validator in routes
  logger.info(
    `Admin: Attempting to update user ${userIdToUpdate} with data:`,
    req.body
  );

  const allowedAdminUpdates = [
    "firstName",
    "lastName",
    "email",
    "phoneNo",
    "role",
    "active",
    "isEmailVerified",
    "bio",
    "hobbies",
    "skills",
    "peoplePreference",
    "availability",
    "ratePerHour",
    "address",
    // Admin can update Stripe info if needed, carefully
    "stripeAccountId",
    "stripeChargesEnabled",
    "stripePayoutsEnabled",
    // Explicitly DO NOT allow direct password update here.
  ];
  const filteredBody = filterObj(req.body, ...allowedAdminUpdates);

  // Handle complex fields if admin sends them
  if (req.body.hobbies !== undefined) {
    filteredBody.hobbies = Array.isArray(req.body.hobbies)
      ? req.body.hobbies
      : String(req.body.hobbies || "")
          .split(",")
          .map((h) => h.trim())
          .filter((h) => h);
  }
  if (req.body.skills !== undefined) {
    filteredBody.skills = Array.isArray(req.body.skills)
      ? req.body.skills
      : String(req.body.skills || "")
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s);
  }
  if (req.body.role && !Array.isArray(req.body.role)) {
    filteredBody.role = [req.body.role];
  } // Ensure role is array
  if (req.body.availability && typeof req.body.availability === "object") {
    filteredBody.availability = req.body.availability;
  }
  if (req.body.address && typeof req.body.address === "object") {
    filteredBody.address = req.body.address;
  }

  const user = await User.findByIdAndUpdate(userIdToUpdate, filteredBody, {
    new: true,
    runValidators: true,
  });

  if (!user)
    return next(new AppError("No user found with that ID to update", 404));
  logger.info(`Admin successfully updated user ${userIdToUpdate}`);
  res.status(200).json({ status: "success", data: { user } });
});

// Delete User by Admin
export const deleteUser = catchAsync(async (req, res, next) => {
  const userIdToDelete = req.params.id;
  // Validation for userIdToDelete format is done by express-validator in routes
  logger.warn(
    `ADMIN ACTION: Attempting to permanently delete user ${userIdToDelete}`
  );

  if (req.user.id === userIdToDelete) {
    // Prevent admin from deleting themselves
    return next(
      new AppError(
        "Admins cannot delete their own account via this route.",
        400
      )
    );
  }

  // --- Comprehensive Deletion Logic (Placeholder - requires significant work) ---
  // 1. Find user to get associated data like S3 keys
  const user = await User.findById(userIdToDelete).select(
    "+profileImageKey +album.key"
  );
  if (!user)
    return next(new AppError("No user found with that ID to delete", 404));

  // 2. Delete S3 assets (profile image, album photos)
  if (user.profileImageKey && user.profileImageKey !== "default.jpg") {
    const deleteParams = {
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: user.profileImageKey,
    };
    try {
      await s3Client.send(new DeleteObjectCommand(deleteParams));
      logger.info(
        `Admin: Deleted profile image ${user.profileImageKey} from S3.`
      );
    } catch (e) {
      logger.error(
        `Admin: Failed to delete profile image ${user.profileImageKey} from S3.`,
        e
      );
    }
  }
  if (user.album && user.album.length > 0) {
    for (const photo of user.album) {
      if (photo.key) {
        const deleteParams = {
          Bucket: process.env.AWS_S3_BUCKET_NAME,
          Key: photo.key,
        };
        try {
          await s3Client.send(new DeleteObjectCommand(deleteParams));
          logger.info(`Admin: Deleted album photo ${photo.key} from S3.`);
        } catch (e) {
          logger.error(
            `Admin: Failed to delete album photo ${photo.key} from S3.`,
            e
          );
        }
      }
    }
  }

  // 3. Handle related documents (Gigs, Contracts, Posts, Reviews, Messages, Payments)
  //    Options: Delete them, anonymize (set createdBy/postedBy to null or a "Deleted User" ID), or reassign.
  //    This is complex and depends on your business rules.
  //    Example: Delete Gigs posted by user
  //    await Gig.deleteMany({ postedBy: userIdToDelete });
  //    logger.info(`Admin: Deleted Gigs posted by user ${userIdToDelete}`);
  //    Example: Anonymize reviews written by user
  //    await Review.updateMany({ reviewer: userIdToDelete }, { $unset: { reviewer: "" } }); // Or set to a placeholder
  //    logger.info(`Admin: Anonymized reviews written by user ${userIdToDelete}`);

  // 4. Finally, delete the user document
  await User.findByIdAndDelete(userIdToDelete);
  // --- End Comprehensive Deletion Logic ---

  logger.warn(
    `ADMIN ACTION: User ${userIdToDelete} and associated data (attempted) permanently deleted.`
  );
  res.status(204).json({ status: "success", data: null });
});
