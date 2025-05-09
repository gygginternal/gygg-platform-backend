import mongoose from 'mongoose';
import User from '../models/User.js';
import AppError from '../utils/AppError.js';
import catchAsync from '../utils/catchAsync.js';
import logger from '../utils/logger.js';
import { s3Client } from '../config/s3Config.js'; // Assuming s3Config exports s3Client
import { DeleteObjectCommand } from '@aws-sdk/client-s3';

// --- Utility: Filter object to only allowed fields ---
const filterObj = (obj, ...allowedFields) => {
  const newObj = {};
  Object.keys(obj).forEach((el) => {
    if (allowedFields.includes(el)) {
        // Handle nested objects like address and availability carefully
        if ((el === 'address' || el === 'availability') && typeof obj[el] === 'object' && obj[el] !== null) {
            newObj[el] = { ...obj[el] }; // Shallow copy to avoid modifying original
        } else if (Array.isArray(obj[el])) {
            newObj[el] = [...obj[el]]; // Shallow copy array
        }
        else {
            newObj[el] = obj[el];
        }
    }
  });
  return newObj;
};

// --- Controller: Get the current logged-in user (sets up for getUser) ---
export const getMe = (req, res, next) => {
  req.params.id = req.user.id; // Use the authenticated user's ID
  logger.debug(`getMe: Setting params.id to ${req.user.id} for getUser call`);
  next();
};

// --- Controller: Update logged-in user's data (non-password fields only) ---
export const updateMe = catchAsync(async (req, res, next) => {
  logger.debug(`updateMe: User ${req.user.id} attempting to update profile. Body:`, req.body);
  logger.debug(`updateMe: User ${req.user.id} file data:`, req.file);


  if (req.body.password || req.body.passwordConfirm) {
    return next(
      new AppError('This route is not for password updates. Please use /updateMyPassword.', 400)
    );
  }

  // Define fields a user is allowed to update on their own profile
  const allowedFields = [
    'firstName', 'lastName', // 'email', // Email changes often need re-verification, handle with care
    'phoneNo', 'bio', 'hobbies', 'skills', // Add skills if in your User model
    'peoplePreference', 'availability', 'ratePerHour', 'address'
    // 'profileImage' is handled by file upload logic below
  ];
  const filteredBody = filterObj(req.body, ...allowedFields);

  // --- Handle complex fields manually ---
  // Hobbies & Skills (assuming comma-separated string input, converting to array)
  if (req.body.hobbies !== undefined) {
       const hobbiesString = String(req.body.hobbies || '');
       filteredBody.hobbies = hobbiesString.split(',').map(h => h.trim()).filter(h => h);
  }
  if (req.body.skills !== undefined) { // If you have a 'skills' field
       const skillsString = String(req.body.skills || '');
       filteredBody.skills = skillsString.split(',').map(s => s.trim()).filter(s => s);
  }
  // Availability (ensure it's an object with expected boolean days)
  if (req.body.availability && typeof req.body.availability === 'object') {
      // Optionally validate specific day properties here if needed
      filteredBody.availability = req.body.availability;
  } else if (req.body.availability) {
      logger.warn(`updateMe: Invalid availability data received for user ${req.user.id}`);
      delete filteredBody.availability; // Or handle as error
  }
  // Address (ensure it's an object and update fields)
  if (req.body.address && typeof req.body.address === 'object') {
       filteredBody.address = {
            street: req.body.address.street?.trim() || '',
            city: req.body.address.city?.trim() || '',
            state: req.body.address.state?.trim() || '',
            postalCode: req.body.address.postalCode?.trim() || '',
            country: req.body.address.country?.trim() || '',
       };
  } else if (req.body.address) {
       logger.warn(`updateMe: Invalid address data received for user ${req.user.id}`);
       delete filteredBody.address;
  }


  // --- Handle Profile Image Upload (if provided) ---
  if (req.file && req.file.fieldname === 'profileImage') {
    logger.info(`updateMe: Profile image received for user ${req.user.id}. Path: ${req.file.location}`);
    filteredBody.profileImage = req.file.location; // URL from multer-s3
    filteredBody.profileImageKey = req.file.key;   // S3 Key from multer-s3

    // Delete old S3 profile image if updating and it's not the default
    const user = await User.findById(req.user.id).select('+profileImageKey'); // Need to select the key
    if (user?.profileImageKey && user.profileImageKey !== 'default.jpg') {
      logger.info(`updateMe: Deleting old profile image from S3: ${user.profileImageKey}`);
      const deleteParams = { Bucket: process.env.AWS_S3_BUCKET_NAME, Key: user.profileImageKey };
      try {
        await s3Client.send(new DeleteObjectCommand(deleteParams));
      } catch (s3DeleteError) {
        logger.error('updateMe: Failed to delete old profile image from S3', { key: user.profileImageKey, error: s3DeleteError });
        // Non-critical error, proceed with DB update
      }
    }
  }

  // --- Update User Document ---
  if (Object.keys(filteredBody).length === 0 && !req.file) {
       return next(new AppError('No valid fields provided for update.', 400));
  }

  logger.debug(`updateMe: Updating user ${req.user.id} with data:`, filteredBody);
  const updatedUser = await User.findByIdAndUpdate(req.user.id, filteredBody, {
    new: true, // Return the modified document rather than the original
    runValidators: true, // Ensure schema validations run on update
  });

  if (!updatedUser) { // Should not happen if protect middleware ensures user exists
    return next(new AppError('User not found, update failed.', 404));
  }

  logger.info(`User profile updated successfully for ${req.user.id}`);
  res.status(200).json({
    status: 'success',
    data: { user: updatedUser },
  });
});

// --- Controller: Deactivate logged-in user's account ---
export const deleteMe = catchAsync(async (req, res, next) => {
  logger.warn(`User ${req.user.id} deactivating their account.`);
  await User.findByIdAndUpdate(req.user.id, { active: false });
  // TODO: Add more logic here? e.g., logout, anonymize some data
  res.status(204).json({ status: 'success', data: null });
});

// --- Controller: Upload album photo ---
export const uploadAlbumPhoto = catchAsync(async (req, res, next) => {
  logger.debug('uploadAlbumPhoto: File data:', req.file);
  logger.debug('uploadAlbumPhoto: Body data:', req.body);

  if (!req.file) return next(new AppError('No image file uploaded.', 400));
  if (!req.body.caption || req.body.caption.trim() === '') {
    logger.warn(`uploadAlbumPhoto: Missing caption. Deleting S3 object ${req.file.key} for user ${req.user.id}`);
    const deleteParams = { Bucket: process.env.AWS_S3_BUCKET_NAME, Key: req.file.key };
    try { await s3Client.send(new DeleteObjectCommand(deleteParams)); }
    catch (s3DelErr) { logger.error('Failed to delete S3 object after captionless album upload', { key: req.file.key, error: s3DelErr }); }
    return next(new AppError('Photo caption is required.', 400));
  }

  const user = await User.findById(req.user.id);
  if (!user) { /* Handle user not found, delete S3 file */ return next(new AppError('User not found.', 404)); }

  const newPhoto = {
    url: req.file.location, // URL from multer-s3
    key: req.file.key,     // S3 Key from multer-s3
    caption: req.body.caption.trim(),
  };

  user.album.push(newPhoto);
  await user.save({ validateBeforeSave: false }); // Skip full validation if only adding to array
  const addedPhoto = user.album.id(newPhoto._id) || user.album[user.album.length - 1]; // Get the added subdocument

  logger.info(`Album photo added for user ${req.user.id}`, { photoId: addedPhoto?._id, key: newPhoto.key });
  res.status(201).json({ status: 'success', data: { photo: addedPhoto } });
});

// --- Controller: Get user album (own or another user's) ---
export const getUserAlbum = catchAsync(async (req, res, next) => {
  const userIdToFetch = req.params.userId || req.user.id; // If :userId param exists, use it; otherwise, use logged-in user's ID
  if (!mongoose.Types.ObjectId.isValid(userIdToFetch)) return next(new AppError('Invalid user ID format.', 400));

  logger.debug(`getUserAlbum: Fetching album for user ID: ${userIdToFetch}`);
  const userWithAlbum = await User.findById(userIdToFetch).select('album firstName lastName');
  if (!userWithAlbum) return next(new AppError('User not found.', 404));

  res.status(200).json({
    status: 'success',
    results: userWithAlbum.album.length,
    data: { album: userWithAlbum.album, ownerName: `${userWithAlbum.firstName} ${userWithAlbum.lastName}`.trim() },
  });
});

// --- Controller: Delete album photo (own photo only) ---
export const deleteAlbumPhoto = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const photoId = req.params.photoId;
  // Validation for photoId is done by express-validator in routes

  logger.debug(`deleteAlbumPhoto: User ${userId} attempting to delete photo ${photoId}`);
  // Find the user and the specific photo to get its S3 key
  const user = await User.findById(userId).select('album'); // Select only album for efficiency
  if (!user) return next(new AppError('User not found.', 404)); // Should be caught by protect

  const photoToDelete = user.album.id(photoId); // Find subdocument by its _id

  if (!photoToDelete) {
    return next(new AppError('Photo not found in your album.', 404));
  }

  // Delete from S3 if key exists
  if (photoToDelete.key) {
    const deleteParams = { Bucket: process.env.AWS_S3_BUCKET_NAME, Key: photoToDelete.key };
    try {
      logger.info(`deleteAlbumPhoto: Deleting S3 object ${photoToDelete.key} for user ${userId}`);
      await s3Client.send(new DeleteObjectCommand(deleteParams));
      logger.info(`S3 object ${photoToDelete.key} deleted successfully.`);
    } catch (s3DeleteError) {
      logger.error('deleteAlbumPhoto: S3 deletion failed.', { key: photoToDelete.key, error: s3DeleteError });
      // Decide on error handling: proceed to remove from DB or return 500?
      // For now, proceed to remove from DB, but log the S3 error.
    }
  } else {
    logger.warn(`deleteAlbumPhoto: Photo ${photoId} had no S3 key for user ${userId}. Only removing from DB.`);
  }

  // Remove from MongoDB array using $pull
  await User.updateOne(
    { _id: userId },
    { $pull: { album: { _id: photoId } } }
  );

  logger.info(`Album photo ${photoId} removed from DB for user ${userId}`);
  res.status(204).json({ status: 'success', data: null });
});

// --- Controller: Match taskers (for providers) ---
export const matchTaskers = catchAsync(async (req, res, next) => {
    const provider = req.user;
    const providerHobbies = provider.hobbies || [];
    const providerPreference = provider.peoplePreference || '';
    const providerId = provider._id;

    logger.debug(`matchTaskers: Provider ${providerId} searching. Hobbies: [${providerHobbies.join(', ')}], Pref: "${providerPreference}"`);

    if (providerHobbies.length === 0 && !providerPreference.trim()) {
        logger.info(`matchTaskers: Provider ${providerId} has no preferences. Returning top-rated.`);
        const topTaskers = await User.find({ role: 'tasker', active: true, _id: { $ne: providerId } })
            .sort({ rating: -1, ratingCount: -1 }).limit(10)
            .select('firstName lastName fullName profileImage rating ratingCount bio peoplePreference hobbies skills'); // Added skills
        return res.status(200).json({ status: 'success', message: 'Showing top-rated taskers.', results: topTaskers.length, data: { taskers: topTaskers }});
    }

    const pipeline = [];
    pipeline.push({ $match: { role: 'tasker', active: true, _id: { $ne: providerId } } });

    if (providerPreference.trim()) {
        pipeline.push({ $match: { $text: { $search: providerPreference } } });
        pipeline.push({ $addFields: { score: { $meta: 'textScore' } } });
    } else {
        pipeline.push({ $addFields: { score: 0 } });
    }

    const matchOrConditions = [];
    if (providerPreference.trim()) matchOrConditions.push({ score: { $gt: 0 } });
    if (providerHobbies.length > 0) matchOrConditions.push({ hobbies: { $in: providerHobbies } });
    // You could add skills matching here too if provider has a skills preference field
    // if (provider.skillsPreference && provider.skillsPreference.length > 0) matchOrConditions.push({ skills: { $in: provider.skillsPreference } });

    if (matchOrConditions.length > 0) { pipeline.push({ $match: { $or: matchOrConditions } }); }

    pipeline.push({ $sort: { score: -1, rating: -1, ratingCount: -1 } });

    const page = req.query.page * 1 || 1; const limit = req.query.limit * 1 || 10; const skip = (page - 1) * limit;
    pipeline.push({ $skip: skip }); pipeline.push({ $limit: limit });

    pipeline.push({ $project: { _id: 1, firstName: 1, lastName: 1, fullName: 1, profileImage: 1, rating: 1, ratingCount: 1, bio: 1, peoplePreference: 1, hobbies: 1, skills: 1, role: 1, score: 1 } });

    // logger.debug('Executing Provider->Tasker Match Pipeline:', JSON.stringify(pipeline));
    const matchedTaskers = await User.aggregate(pipeline);
    logger.info(`matchTaskers: Found ${matchedTaskers.length} taskers for provider ${providerId}.`);

    res.status(200).json({ status: 'success', results: matchedTaskers.length, data: { taskers: matchedTaskers } });
});


// --- ADMIN CONTROLLERS ---

// Get All Users (Admin)
export const getAllUsers = catchAsync(async (req, res, next) => {
  logger.debug('Admin: Fetching all users', { query: req.query });
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const skip = (page - 1) * limit;

  const users = await User.find().skip(skip).limit(limit);
  const totalUsers = await User.countDocuments();

  res.status(200).json({
    status: 'success',
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
    return next(new AppError('No user found with that ID', 404));
  }
  res.status(200).json({
    status: 'success',
    data: { user },
  });
});

// Update User by Admin
export const updateUser = catchAsync(async (req, res, next) => {
  const userIdToUpdate = req.params.id;
  // Validation for userIdToUpdate format is done by express-validator in routes
  logger.info(`Admin: Attempting to update user ${userIdToUpdate} with data:`, req.body);

  const allowedAdminUpdates = [
      'firstName', 'lastName', 'email', 'phoneNo', 'role', 'active', 'isEmailVerified',
      'bio', 'hobbies', 'skills', 'peoplePreference', 'availability', 'ratePerHour', 'address',
      // Admin can update Stripe info if needed, carefully
      'stripeAccountId', 'stripeChargesEnabled', 'stripePayoutsEnabled'
      // Explicitly DO NOT allow direct password update here.
  ];
  const filteredBody = filterObj(req.body, ...allowedAdminUpdates);

  // Handle complex fields if admin sends them
  if (req.body.hobbies !== undefined) { filteredBody.hobbies = Array.isArray(req.body.hobbies) ? req.body.hobbies : String(req.body.hobbies || '').split(',').map(h => h.trim()).filter(h => h); }
  if (req.body.skills !== undefined) { filteredBody.skills = Array.isArray(req.body.skills) ? req.body.skills : String(req.body.skills || '').split(',').map(s => s.trim()).filter(s => s); }
  if (req.body.role && !Array.isArray(req.body.role)) { filteredBody.role = [req.body.role]; } // Ensure role is array
  if (req.body.availability && typeof req.body.availability === 'object') { filteredBody.availability = req.body.availability; }
  if (req.body.address && typeof req.body.address === 'object') { filteredBody.address = req.body.address; }


  const user = await User.findByIdAndUpdate(userIdToUpdate, filteredBody, {
      new: true,
      runValidators: true
  });

  if (!user) return next(new AppError('No user found with that ID to update', 404));
  logger.info(`Admin successfully updated user ${userIdToUpdate}`);
  res.status(200).json({ status: 'success', data: { user } });
});


// Delete User by Admin
export const deleteUser = catchAsync(async (req, res, next) => {
  const userIdToDelete = req.params.id;
  // Validation for userIdToDelete format is done by express-validator in routes
  logger.warn(`ADMIN ACTION: Attempting to permanently delete user ${userIdToDelete}`);

  if (req.user.id === userIdToDelete) { // Prevent admin from deleting themselves
     return next(new AppError('Admins cannot delete their own account via this route.', 400));
  }

  // --- Comprehensive Deletion Logic (Placeholder - requires significant work) ---
  // 1. Find user to get associated data like S3 keys
  const user = await User.findById(userIdToDelete).select('+profileImageKey +album.key');
  if (!user) return next(new AppError('No user found with that ID to delete', 404));

  // 2. Delete S3 assets (profile image, album photos)
  if (user.profileImageKey && user.profileImageKey !== 'default.jpg') {
      const deleteParams = { Bucket: process.env.AWS_S3_BUCKET_NAME, Key: user.profileImageKey };
      try { await s3Client.send(new DeleteObjectCommand(deleteParams)); logger.info(`Admin: Deleted profile image ${user.profileImageKey} from S3.`); }
      catch (e) { logger.error(`Admin: Failed to delete profile image ${user.profileImageKey} from S3.`, e); }
  }
  if (user.album && user.album.length > 0) {
      for (const photo of user.album) {
          if (photo.key) {
              const deleteParams = { Bucket: process.env.AWS_S3_BUCKET_NAME, Key: photo.key };
              try { await s3Client.send(new DeleteObjectCommand(deleteParams)); logger.info(`Admin: Deleted album photo ${photo.key} from S3.`); }
              catch (e) { logger.error(`Admin: Failed to delete album photo ${photo.key} from S3.`, e); }
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

  logger.warn(`ADMIN ACTION: User ${userIdToDelete} and associated data (attempted) permanently deleted.`);
  res.status(204).json({ status: 'success', data: null });
});