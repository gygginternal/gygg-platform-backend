import User from '../models/User.js';
import AppError from '../utils/AppError.js';
import catchAsync from '../utils/catchAsync.js';

// --- Utility: Filters object keys to only allowed fields ---
const filterObj = (obj, ...allowedFields) => {
  const newObj = {};
  Object.keys(obj).forEach((el) => {
    if (allowedFields.includes(el)) newObj[el] = obj[el];
  });
  return newObj;
};

// --- Controller: Get the current logged-in user ---
export const getMe = (req, res, next) => {
  req.params.id = req.user.id; // Inject user ID for the getUser controller
  next();
};

// --- Controller: Update logged-in user's data (non-password fields only) ---
export const updateMe = catchAsync(async (req, res, next) => {
  // 1. Prevent password updates via this route
  if (req.body.password || req.body.passwordConfirm) {
    return next(
      new AppError(
        'This route is not for password updates. Please use /updateMyPassword.',
        400
      )
    );
  }

  // 2. Filter allowed fields to update
  const filteredBody = filterObj(
    req.body,
    'firstName',
    'lastName',
    'email',
    'phoneNo',
    'address',
    'bio',
    'profileImage', // ⚠️ Consider moving image upload to a separate endpoint
    'hobbies',
    'peoplePreference',
    'availability',
    'ratePerHour'
  );

  // 3. Update the user in DB
  const updatedUser = await User.findByIdAndUpdate(req.user.id, filteredBody, {
    new: true, // Return updated document
    runValidators: true, // Run schema validators
  });

  res.status(200).json({
    status: 'success',
    data: { user: updatedUser },
  });
});

// --- Controller: Deactivate the logged-in user's account (soft delete) ---
export const deleteMe = catchAsync(async (req, res, next) => {
  await User.findByIdAndUpdate(req.user.id, { active: false });

  res.status(204).json({
    status: 'success',
    data: null,
  });
});


// Match taskers with providers based on hobbies and personality
export const matchTaskers = catchAsync(async (req, res, next) => {
  const provider = req.user;
  const providerHobbies = provider.hobbies || [];
  const providerPreference = provider.peoplePreference || '';
  const providerId = provider._id;

  // Fallback if provider has no preferences
  if (providerHobbies.length === 0 && !providerPreference.trim()) {
       console.log(`Provider ${providerId} has no preferences set. Returning top-rated taskers.`);
       const topTaskers = await User.find({ role: 'tasker', active: true, _id: { $ne: providerId } })
                                   .sort({ rating: -1, ratingCount: -1 }).limit(10)
                                   .select('firstName lastName fullName profileImage rating ratingCount bio peoplePreference hobbies');
       return res.status(200).json({ status: 'success', message: 'Showing top-rated taskers.', results: topTaskers.length, data: { taskers: topTaskers }});
  }

  const pipeline = [];
  pipeline.push({ $match: { role: 'tasker', active: true, _id: { $ne: providerId } } }); // Initial match

  // Text search and score
  if (providerPreference.trim()) {
      pipeline.push({ $match: { $text: { $search: providerPreference } } });
      pipeline.push({ $addFields: { score: { $meta: 'textScore' } } });
  } else {
       pipeline.push({ $addFields: { score: 0 } });
  }

  // Filter by matching text OR hobbies
  const matchOrConditions = [];
  if (providerPreference.trim()) matchOrConditions.push({ score: { $gt: 0 } });
  if (providerHobbies.length > 0) matchOrConditions.push({ hobbies: { $in: providerHobbies } });
  if (matchOrConditions.length > 0) { pipeline.push({ $match: { $or: matchOrConditions } }); }

  // Sorting
  pipeline.push({ $sort: { score: -1, rating: -1, ratingCount: -1 } });

  // Pagination
  const page = req.query.page * 1 || 1; const limit = req.query.limit * 1 || 10; const skip = (page - 1) * limit;
  pipeline.push({ $skip: skip }); pipeline.push({ $limit: limit });

  // Projection
  pipeline.push({ $project: { _id: 1, firstName: 1, lastName: 1, fullName: 1, profileImage: 1, rating: 1, ratingCount: 1, bio: 1, peoplePreference: 1, hobbies: 1, role: 1, score: 1 } });

  console.log('Executing Provider->Tasker Match Pipeline:', JSON.stringify(pipeline));
  const matchedTaskers = await User.aggregate(pipeline);
  res.status(200).json({ status: 'success', results: matchedTaskers.length, data: { taskers: matchedTaskers } });
});

// =================== ADMIN ROUTES ===================

// --- Controller: Get all users (Admin only) ---
export const getAllUsers = catchAsync(async (req, res, next) => {
  const users = await User.find();

  // 💡 Future: Add filtering, pagination, sorting (e.g., with APIFeatures utility)
  res.status(200).json({
    status: 'success',
    results: users.length,
    data: { users },
  });
});

// --- Controller: Get a user by ID (Admin or getMe) ---
export const getUser = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    return next(new AppError('No user found with that ID', 404));
  }

  res.status(200).json({
    status: 'success',
    data: { user },
  });
});

// --- Controller: Admin update user (non-password fields) ---
export const updateUser = catchAsync(async (req, res, next) => {
  // Filter the fields that admin is allowed to update
  const filteredBody = filterObj(
    req.body,
    'firstName',
    'lastName',
    'email',
    'phoneNo',
    'role',
    'active' // ⚠️ Be cautious with direct role or status changes
  );

  const user = await User.findByIdAndUpdate(req.params.id, filteredBody, {
    new: true,
    runValidators: true,
  });

  if (!user) {
    return next(new AppError('No user found with that ID', 404));
  }

  res.status(200).json({
    status: 'success',
    data: { user },
  });
});

// --- Controller: Permanently delete a user (Admin only) ---
export const deleteUser = catchAsync(async (req, res, next) => {
  const user = await User.findByIdAndDelete(req.params.id);

  if (!user) {
    return next(new AppError('No user found with that ID', 404));
  }

  // ⚠️ Future Consideration:
  // - Cascade delete or anonymize related data (posts, gigs, messages, etc.)
  // - Consider archiving data instead of hard delete

  res.status(204).json({
    status: 'success',
    data: null,
  });
});
