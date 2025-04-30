import User from '../models/User.js';
import AppError from '../utils/AppError.js';
import catchAsync from '../utils/catchAsync.js';

// --- Helper Function to Filter Allowed Fields ---
const filterObj = (obj, ...allowedFields) => {
  const newObj = {};
  Object.keys(obj).forEach(el => {
    if (allowedFields.includes(el)) newObj[el] = obj[el];
  });
  return newObj;
};

// --- User Routes Handlers ---

// Get Current User's Data
export const getMe = (req, res, next) => {
  req.params.id = req.user.id; // Set id from logged-in user for getUser
  next();
};

// Update Current User's Data (Non-Password)
export const updateMe = catchAsync(async (req, res, next) => {
  // 1) Create error if user POSTs password data
  if (req.body.password || req.body.passwordConfirm) {
    return next(
      new AppError(
        'This route is not for password updates. Please use /updateMyPassword.',
        400
      )
    );
  }

  // 2) Filter out unwanted fields names that are not allowed to be updated
  const filteredBody = filterObj(req.body,
    'firstName',
    'lastName',
    'email',
    'phoneNo',
    'address',
    'bio',
    'profileImage', // Consider separate endpoint for image uploads later
    'hobbies',
    'peoplePreference',
    'availability',
    'ratePerHour'
   );
   // Add 'role' if you allow self-updating roles, but generally not recommended

  // 3) Update user document
  const updatedUser = await User.findByIdAndUpdate(req.user.id, filteredBody, {
    new: true, // Return the updated document
    runValidators: true, // Run schema validators on update
  });

  res.status(200).json({
    status: 'success',
    data: {
      user: updatedUser,
    },
  });
});

// Deactivate Current User Account
export const deleteMe = catchAsync(async (req, res, next) => {
  await User.findByIdAndUpdate(req.user.id, { active: false });

  res.status(204).json({ // 204 No Content
    status: 'success',
    data: null,
  });
});

// --- Admin Routes Handlers ---

// Get All Users (Admin)
export const getAllUsers = catchAsync(async (req, res, next) => {
  // Add filtering/pagination/sorting later if needed
  const users = await User.find();

  res.status(200).json({
    status: 'success',
    results: users.length,
    data: {
      users,
    },
  });
});

// Get Single User (Admin or using getMe)
export const getUser = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    return next(new AppError('No user found with that ID', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      user,
    },
  });
});

// Update User (Admin - Do NOT update passwords with this!)
export const updateUser = catchAsync(async (req, res, next) => {
    // Filter req.body similar to updateMe if needed, prevent password updates here
    const filteredBody = filterObj(req.body,
      'firstName', 'lastName', 'email', 'phoneNo', 'role', 'active' // Example fields admin can update
    );

    const user = await User.findByIdAndUpdate(req.params.id, filteredBody, {
        new: true,
        runValidators: true
    });

    if (!user) {
        return next(new AppError('No user found with that ID', 404));
    }

    res.status(200).json({
        status: 'success',
        data: {
        user
        }
    });
});


// Delete User (Admin - Hard Delete, use with caution!)
export const deleteUser = catchAsync(async (req, res, next) => {
  const user = await User.findByIdAndDelete(req.params.id);

  if (!user) {
    return next(new AppError('No user found with that ID', 404));
  }

  // Note: Consider if associated data (gigs, posts, etc.) should be anonymized or deleted.
  // This simple delete doesn't handle that.

  res.status(204).json({ // 204 No Content
    status: 'success',
    data: null,
  });
});