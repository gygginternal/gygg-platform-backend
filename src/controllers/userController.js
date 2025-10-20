import mongoose from "mongoose";
import User from "../models/User.js";
import AppError from "../utils/AppError.js";
import catchAsync from "../utils/catchAsync.js";
import logger from "../utils/logger.js";
import { findDocumentById, updateDocumentById, withTransaction, paginateResults } from "../utils/dbHelpers.js";
import { deleteS3Object, cleanupS3Objects } from "../utils/s3Helpers.js";
import { sendSuccessResponse, sendCreatedResponse, sendNoContentResponse, sendPaginatedResponse } from "../utils/responseHelpers.js";
import { Gig } from '../models/Gig.js';
import Post from '../models/Post.js';
import ChatMessage from '../models/ChatMessage.js';
import Contract from '../models/Contract.js';
import Payment from '../models/Payment.js';
import Application from '../models/Application.js';
import Review from '../models/Review.js';
import Notification from '../models/Notification.js';

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

// Removed deleteS3Object - now using shared utility

// --- Controller: Get the current logged-in user (sets up for getUser) ---
export const getMe = (req, res, next) => {
  req.params.id = req.user.id;
  logger.debug(`getMe: Setting params.id to ${req.user.id}`);
  next();
};

// Helper function to enhance user data with payment information
const enhanceUserWithPaymentInfo = (user) => {
  if (!user) return user;
  
  // Add payment method status information
  const enhancedUser = user.toObject ? user.toObject() : { ...user };
  
  enhancedUser.paymentMethods = {
    stripe: {
      connected: !!user.stripeAccountId,
      accountId: user.stripeAccountId,
      chargesEnabled: user.stripeChargesEnabled,
      payoutsEnabled: user.stripePayoutsEnabled,
      customerId: user.stripeCustomerId,
      default: user.defaultPaymentMethod === 'stripe'
    },
    nuvei: {
      connected: !!user.nuveiAccountId,
      accountId: user.nuveiAccountId,
      customerId: user.nuveiCustomerId,
      bankTransferEnabled: user.nuveiBankTransferEnabled,
      bankDetails: user.nuveiBankDetails,
      default: user.defaultPaymentMethod === 'nuvei'
    },
    defaultMethod: user.defaultPaymentMethod || 'stripe'
  };
  
  return enhancedUser;
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
  const updatedUser = await updateDocumentById(User, req.user.id, filteredBody, { new: true, runValidators: true }, 'User not found after update.');

  logger.info(`User profile updated successfully for ${req.user.id}`);
  sendSuccessResponse(res, 200, { user: updatedUser });
});

// --- Controller: Deactivate logged-in user's account ---
export const deleteMe = catchAsync(async (req, res, next) => {
  logger.warn(`User ${req.user.id} deleting their account. Starting cleanup.`);
  
  await withTransaction(async (session) => {
    const user = await findDocumentById(User, req.user.id, 'User not found.');
    
    // S3: Delete profile image
    await deleteS3Object(user.profileImageKey);
    
    // S3: Delete album images
    await cleanupS3Objects(user.album);

    // DB: Cascade delete related records
    await Promise.all([
      Gig.deleteMany({ postedBy: user._id }, { session }),
      Post.deleteMany({ author: user._id }, { session }),
      ChatMessage.deleteMany({ $or: [{ sender: user._id }, { receiver: user._id }] }, { session }),
      Contract.deleteMany({ $or: [{ provider: user._id }, { tasker: user._id }] }, { session }),
      Payment.deleteMany({ $or: [{ payer: user._id }, { payee: user._id }] }, { session }),
      Application.deleteMany({ user: user._id }, { session }),
      Review.deleteMany({ $or: [{ reviewer: user._id }, { reviewee: user._id }] }, { session }),
      Notification.deleteMany({ user: user._id }, { session }),
    ]);

    // Finally, delete the user
    await User.findByIdAndDelete(user._id, { session });
    logger.warn(`User ${user._id} and all related data deleted.`);
    await notifyAdmin('User account deleted', { userId: user._id, email: user.email });
  });

  sendNoContentResponse(res);
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

// --- Controller: Get a user's album (public to logged-in users) ---
export const getUserAlbum = catchAsync(async (req, res, next) => {
  const userId = req.params.userId || req.user.id;
  logger.debug(`getUserAlbum: Fetching album for user ID: ${userId}`);
  const user = await User.findById(userId).select('album firstName lastName profileImage');
  if (!user) return next(new AppError('User not found.', 404));
  // No restriction: any logged-in user can view another user's album
  res.status(200).json({ status: 'success', data: { album: user.album, user: { firstName: user.firstName, lastName: user.lastName, profileImage: user.profileImage } } });
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
    const providerPreferences = Array.isArray(provider.peoplePreference) 
        ? provider.peoplePreference 
        : (provider.peoplePreference ? [provider.peoplePreference] : []);
    const providerId = provider._id;
    
    // Get search term from query parameters
    const searchTerm = req.query.search ? req.query.search.trim() : '';

    logger.debug(`matchTaskers: Provider ${providerId} searching. Search term: "${searchTerm}", Hobbies: [${providerHobbies.join(', ')}], Preferences: [${providerPreferences.join(', ')}]`);

    // Build base query
    const baseQuery = { role: 'tasker', active: true, _id: { $ne: providerId } };
    
    // Add text search to base query if search term provided
    if (searchTerm) {
        baseQuery.$text = { $search: searchTerm };
        logger.debug(`matchTaskers: Using text search for: "${searchTerm}"`);
    }

    // If no preferences and no search term, return top-rated taskers
    if (providerHobbies.length === 0 && providerPreferences.length === 0 && !searchTerm) {
        logger.info(`matchTaskers: Provider ${providerId} has no preferences or search term. Returning top-rated.`);
        const topTaskers = await User.find(baseQuery)
            .sort({ rating: -1, ratingCount: -1 })
            .limit(10)
            .select('firstName lastName fullName profileImage rating ratingCount bio peoplePreference hobbies skills address ratePerHour');
        return res.status(200).json({ 
            status: 'success', 
            message: 'Showing top-rated taskers.', 
            results: topTaskers.length, 
            data: { taskers: topTaskers }
        });
    }

    // Find all matching taskers
    const taskers = await User.find(baseQuery)
        .select('firstName lastName fullName profileImage rating ratingCount bio peoplePreference hobbies skills address ratePerHour');

    // Calculate compatibility scores for each tasker
    const scoredTaskers = taskers.map(tasker => {
        const hobbyOverlap = Array.isArray(tasker.hobbies)
            ? tasker.hobbies.filter(h => providerHobbies.includes(h)).length
            : 0;
        
        const personalityOverlap = Array.isArray(tasker.peoplePreference)
            ? tasker.peoplePreference.filter(p => providerPreferences.includes(p)).length
            : 0;
        
        const compatibilityScore = hobbyOverlap + personalityOverlap;
        
        // Add text search score if applicable
        const textScore = searchTerm ? (tasker._doc?.score || 0) : 0;
        
        return {
            ...tasker.toObject(),
            compatibilityScore,
            hobbyMatches: hobbyOverlap,
            personalityMatches: personalityOverlap,
            textScore,
            totalScore: compatibilityScore + (textScore * 0.1) // Weight text search lower than compatibility
        };
    });

    // Sort by compatibility score first, then by rating
    scoredTaskers.sort((a, b) => {
        // Primary sort: total score (compatibility + text search)
        if (b.totalScore !== a.totalScore) {
            return b.totalScore - a.totalScore;
        }
        // Secondary sort: rating
        if ((b.rating || 0) !== (a.rating || 0)) {
            return (b.rating || 0) - (a.rating || 0);
        }
        // Tertiary sort: rating count
        return (b.ratingCount || 0) - (a.ratingCount || 0);
    });

    // Apply pagination
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const skip = (page - 1) * limit;
    const paginatedTaskers = scoredTaskers.slice(skip, skip + limit);

    logger.info(`matchTaskers: Found ${scoredTaskers.length} taskers for provider ${providerId}. Returning ${paginatedTaskers.length} after pagination.`);
    
    res.status(200).json({ 
        status: 'success', 
        results: paginatedTaskers.length, 
        totalResults: scoredTaskers.length,
        data: { taskers: paginatedTaskers } 
    });
});

// --- Controller: Top match taskers for provider ---
export const topMatchTaskersForProvider = catchAsync(async (req, res, next) => {
  const provider = req.user;
  const providerHobbies = provider.hobbies || [];
  const providerPreferences = Array.isArray(provider.peoplePreference)
    ? provider.peoplePreference
    : (provider.peoplePreference ? [provider.peoplePreference] : []);

  logger.debug(`topMatchTaskersForProvider: Provider ${provider._id} searching. Hobbies: [${providerHobbies.join(', ')}], Preferences: [${providerPreferences.join(', ')}]`);

  // Build search query
  const searchQuery = { role: 'tasker', active: true, _id: { $ne: provider._id } };
  
  // Add text search if search parameter is provided
  if (req.query.search && req.query.search.trim()) {
    const searchTerm = req.query.search.trim();
    searchQuery.$text = { $search: searchTerm };
    logger.debug(`topMatchTaskersForProvider: Applying text search for term: "${searchTerm}"`);
  }

  // Find all taskers except the current user
  const taskers = await User.find(searchQuery)
    .select('firstName lastName fullName profileImage rating ratingCount bio peoplePreference hobbies skills address ratePerHour');

  // Calculate compatibility scores for each tasker
  const scoredTaskers = taskers.map(tasker => {
    const hobbyOverlap = Array.isArray(tasker.hobbies)
      ? tasker.hobbies.filter(h => providerHobbies.includes(h)).length
      : 0;
    const personalityOverlap = Array.isArray(tasker.peoplePreference)
      ? tasker.peoplePreference.filter(p => providerPreferences.includes(p)).length
      : 0;
    
    const compatibilityScore = hobbyOverlap + personalityOverlap;
    
    // Add text search score if applicable
    const textScore = req.query.search ? (tasker._doc?.score || 0) : 0;
    
    return {
      ...tasker.toObject(),
      compatibilityScore,
      hobbyMatches: hobbyOverlap,
      personalityMatches: personalityOverlap,
      textScore,
      totalScore: compatibilityScore + (textScore * 0.1) // Weight text search lower than compatibility
    };
  });

  // Sort by compatibility score first, then by rating
  scoredTaskers.sort((a, b) => {
    // Primary sort: total score (compatibility + text search)
    if (b.totalScore !== a.totalScore) {
      return b.totalScore - a.totalScore;
    }
    // Secondary sort: rating
    if ((b.rating || 0) !== (a.rating || 0)) {
      return (b.rating || 0) - (a.rating || 0);
    }
    // Tertiary sort: rating count
    return (b.ratingCount || 0) - (a.ratingCount || 0);
  });

  logger.info(`topMatchTaskersForProvider: Found ${scoredTaskers.length} taskers for provider ${provider._id}.`);

  res.status(200).json({
    status: 'success',
    results: scoredTaskers.length,
    data: { taskers: scoredTaskers },
  });
});

// --- Controller: Search taskers (public, for all authenticated users) ---
export const searchTaskers = catchAsync(async (req, res, next) => {
    const currentUserId = req.user._id;
    const searchTerm = req.query.search ? req.query.search.trim() : '';
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const skip = (page - 1) * limit;

    logger.debug(`searchTaskers: User ${currentUserId} searching. Search term: "${searchTerm}"`);

    const pipeline = [];
    
    // Match taskers, exclude current user
    pipeline.push({ 
        $match: { 
            role: 'tasker', 
            active: true, 
            _id: { $ne: currentUserId } 
        } 
    });

    // Add text search if search term provided
    if (searchTerm) {
        pipeline.push({ $match: { $text: { $search: searchTerm } } });
        pipeline.push({ $addFields: { textScore: { $meta: 'textScore' } } });
        logger.debug(`searchTaskers: Using text search for: "${searchTerm}"`);
    } else {
        pipeline.push({ $addFields: { textScore: 0 } });
    }

    // Sort by text score (if searching), then by rating
    pipeline.push({ 
        $sort: searchTerm 
            ? { textScore: -1, rating: -1, ratingCount: -1 } 
            : { rating: -1, ratingCount: -1, createdAt: -1 }
    });

    // Pagination
    pipeline.push({ $skip: skip });
    pipeline.push({ $limit: limit });

    // Project fields
    pipeline.push({ 
        $project: {
            _id: 1, 
            firstName: 1, 
            lastName: 1, 
            fullName: 1, 
            profileImage: 1,
            rating: 1, 
            ratingCount: 1, 
            bio: 1, 
            hobbies: 1, 
            skills: 1, 
            address: 1,
            location: 1,
            city: 1,
            state: 1,
            ratePerHour: 1,
            role: 1,
            textScore: 1
        }
    });

    const taskers = await User.aggregate(pipeline);
    logger.info(`searchTaskers: Found ${taskers.length} taskers for user ${currentUserId}.`);
    
    res.status(200).json({ 
        status: 'success', 
        results: taskers.length, 
        data: { taskers } 
    });
});

// --- Controller: Get public profile ---
export const getPublicProfile = catchAsync(async (req, res, next) => {
  const userId = req.params.userId;
  const user = await User.findById(userId).select(
    '_id firstName lastName profileImage bio hobbies peoplePreference skills address rating role'
  );
  if (!user) {
    return next(new AppError('No user found with that ID', 404));
  }
  // Only return city and state from address
  const publicUser = user.toObject();
  if (publicUser.address) {
    publicUser.address = {
      city: publicUser.address.city,
      state: publicUser.address.state,
    };
  }
  res.status(200).json({
    status: 'success',
    data: { user: publicUser },
  });
});

// --- ADMIN CONTROLLERS ---

// Get All Users (Admin)
export const getAllUsers = catchAsync(async (req, res, next) => {
  logger.debug("Admin: Fetching all users", { query: req.query });
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;

  const query = User.find();
  const paginatedData = await paginateResults(query, page, limit);

  sendPaginatedResponse(res, paginatedData, 'users');
});

// Get Single User (Admin or used by getMe)
export const getUser = catchAsync(async (req, res, next) => {
  const userIdToFind = req.params.id; // ID comes from the route parameter (:id)
  logger.debug(`Fetching user data for ID: ${userIdToFind}`);
  const user = await findDocumentById(User, userIdToFind, "No user found with that ID");
  
  // Enhance user with payment information if requesting their own profile
  const enhancedUser = req.user && req.user.id === userIdToFind 
    ? enhanceUserWithPaymentInfo(user) 
    : user;
  
  sendSuccessResponse(res, 200, { user: enhancedUser });
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

async function notifyAdmin(message, data) {
  try {
    await Notification.create({
      user: process.env.ADMIN_USER_ID, // Set this env var to your admin user ID
      type: 'system',
      message,
      data,
    });
  } catch (err) {
    logger.error('Failed to notify admin', { message, data, err });
  }
}
