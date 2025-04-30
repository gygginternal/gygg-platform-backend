import jwt from 'jsonwebtoken';
import { promisify } from 'util'; // Core Node module to promisify callback functions
import User from '../models/User.js';
import AppError from '../utils/AppError.js';
import catchAsync from '../utils/catchAsync.js';

// --- Utility: catchAsync (ensure this exists in ../utils/catchAsync.js) ---
// import catchAsync from '../utils/catchAsync.js';

// --- JWT Token Signing ---
const signToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });
};

// --- Send Token Response (Helper) ---
const createSendToken = (user, statusCode, res) => {
  const token = signToken(user._id);

  // Cookie options
  const cookieOptions = {
    expires: new Date(
      Date.now() + process.env.JWT_COOKIE_EXPIRES_IN * 24 * 60 * 60 * 1000 // days to ms
    ),
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    // sameSite: 'strict' // Consider uncommenting and adjusting ('lax' might be needed)
  };

  res.cookie('jwt', token, cookieOptions);

  // Remove password from output
  user.password = undefined;

  res.status(statusCode).json({
    status: 'success',
    token,
    data: {
      user,
    },
  });
};


// --- Signup ---
export const signup = catchAsync(async (req, res, next) => {
  const { firstName, lastName, email, password, passwordConfirm, role, phoneNo /* other fields */ } = req.body;
  const allowedRoles = ['tasker', 'provider'];
  const finalRoles = role && Array.isArray(role)
    ? role.filter(r => allowedRoles.includes(r))
    : ['tasker']; // Default or adjust as needed

  if (finalRoles.length === 0) {
    return next(new AppError('Please provide at least one valid role (tasker or provider).', 400));
  }

  const newUser = await User.create({
    firstName, lastName, email, password, passwordConfirm,
    role: finalRoles, phoneNo,
  });

  createSendToken(newUser, 201, res);
});

// --- Login ---
export const login = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return next(new AppError('Please provide email and password!', 400));
  }
  const user = await User.findOne({ email }).select('+password');
  if (!user || !(await user.correctPassword(password, user.password))) {
    return next(new AppError('Incorrect email or password', 401));
  }
  createSendToken(user, 200, res);
});

// --- Protect Routes Middleware ---
// Includes extensive logging for debugging token issues
export const protect = catchAsync(async (req, res, next) => {
  console.log('--- Entering protect middleware ---'); // Log entry

  // 1) Getting token and check if it's there
  let token;
  console.log('Headers:', req.headers); // Log all headers
  console.log('Cookies:', req.cookies); // Log cookies

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    token = req.headers.authorization.split(' ')[1];
    console.log('Token found in Authorization header.');
  } else if (req.cookies.jwt) {
    token = req.cookies.jwt;
    console.log('Token found in cookies.');
  } else {
    console.log('No token found in headers or cookies.'); // Log if no token found
  }


  if (!token || token === 'loggedout') { // Added check for 'loggedout' cookie value
    console.log('💥 Protect Middleware: No valid token, denying access.'); // Log denial
    return next(
      new AppError('You are not logged in! Please log in to get access.', 401)
    );
  }

  console.log('Token value found:', token); // Log the token value itself

  // 2) Verification token
  try {
    // promisify converts jwt.verify callback into a promise-based function
    const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);
    console.log('Token decoded successfully:', decoded);

    // 3) Check if user still exists
    // Select fields needed later, including passwordChangedAt
    const currentUser = await User.findById(decoded.id).select('+passwordChangedAt');
    if (!currentUser) {
      console.log('💥 Protect Middleware: User for token no longer exists.'); // Log denial
      return next(
        new AppError(
          'The user belonging to this token does no longer exist.',
          401
        )
      );
    }
    console.log('User found:', currentUser._id.toString());

    // 4) Check if user changed password after the token was issued
    if (currentUser.changedPasswordAfter(decoded.iat)) { // iat: issued at timestamp
      console.log('💥 Protect Middleware: Password changed after token issued.'); // Log denial
      return next(
        new AppError('User recently changed password! Please log in again.', 401)
      );
    }

    // GRANT ACCESS TO PROTECTED ROUTE
    console.log('--- Protect middleware PASSED ---'); // Log success
    // Attach user to request (excluding sensitive fields fetched just for checks)
    req.user = await User.findById(decoded.id); // Fetch user again without selected fields
    res.locals.user = req.user; // Make user available in templates (if using SSR)
    next();

  } catch (error) {
    // Catch JWT errors specifically and pass to global error handler
    console.error('💥 Protect Middleware: Error during token verification:', error.name, error.message);
    // Pass the original JWT error for specific handling (e.g., expired vs invalid)
    // The global error handler will convert these to AppErrors
    return next(error);
  }
});


// --- Restrict Access Middleware (Role-Based) ---
export const restrictTo = (...roles) => {
  return (req, res, next) => {
    // Assumes req.user is populated by the 'protect' middleware
    if (!req.user || !req.user.role) {
         // Should not happen if protect middleware ran correctly
         return next(
            new AppError('User role not found. Authentication issue.', 500)
         );
    }
    // Check if the user's roles array includes at least one of the required roles
    const authorized = req.user.role.some(userRole => roles.includes(userRole));

    if (!authorized) {
      return next(
        new AppError('You do not have permission to perform this action', 403) // 403 Forbidden
      );
    }
    next();
  };
};

// --- Update Password (for logged-in user) ---
export const updatePassword = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user.id).select('+password');
  const { passwordCurrent, password, passwordConfirm } = req.body;

  if (!passwordCurrent || !(await user.correctPassword(passwordCurrent, user.password))) {
    return next(new AppError('Your current password is incorrect', 401));
  }

  user.password = password;
  user.passwordConfirm = passwordConfirm;
  await user.save(); // Triggers pre-save middleware (hashing, passwordChangedAt)

  createSendToken(user, 200, res); // Send new token
});


// --- Logout ---
export const logout = (req, res) => {
  // Clear the JWT cookie
  res.cookie('jwt', 'loggedout', {
    expires: new Date(Date.now() + 5 * 1000), // Expire almost immediately
    httpOnly: true,
  });
  res.status(200).json({ status: 'success' });
};


// --- TODO Later: Forgot Password & Reset Password ---
// export const forgotPassword = catchAsync(async (req, res, next) => { /* ... */ });
// export const resetPassword = catchAsync(async (req, res, next) => { /* ... */ });