import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { promisify } from 'util';
import User from '../models/User.js';
import AppError from '../utils/AppError.js';
import catchAsync from '../utils/catchAsync.js';
// import sendEmail from '../utils/email.js';

// --------------------
// Utility: Sign JWT
// --------------------
const signToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });
};

// --------------------
// Utility: Send JWT in Cookie
// --------------------
const createSendToken = (user, statusCode, res) => {
  const token = signToken(user._id);

  const cookieOptions = {
    expires: new Date(
      Date.now() +
      process.env.JWT_COOKIE_EXPIRES_IN * 24 * 60 * 60 * 1000
    ),
    httpOnly: true, // Prevents access from client-side JS
    secure: process.env.NODE_ENV === 'production', // Send only over HTTPS
  };

  res.cookie('jwt', token, cookieOptions);

  // Remove password before sending user info
  user.password = undefined;

  res.status(statusCode).json({
    status: 'success',
    token,
    data: { user },
  });
};

// --------------------
// SIGNUP
// --------------------
export const signup = catchAsync(async (req, res, next) => {
  const { firstName, lastName, email, password, passwordConfirm, role, phoneNo } = req.body;

  // Accept only allowed roles
  const allowedRoles = ['tasker', 'provider'];
  const finalRoles = Array.isArray(role)
    ? role.filter((r) => allowedRoles.includes(r))
    : ['tasker'];

  if (finalRoles.length === 0) {
    return next(new AppError('Invalid role. Choose either tasker or provider.', 400));
  }

  const newUser = await User.create({
    firstName,
    lastName,
    email,
    password,
    passwordConfirm,
    role: finalRoles,
    phoneNo,
  });

  createSendToken(newUser, 201, res);
});

// --------------------
// LOGIN
// --------------------
export const login = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return next(new AppError('Please provide email and password!', 400));
  }

  const user = await User.findOne({ email }).select('+password');
  const isCorrect = user && await user.correctPassword(password, user.password);

  if (!isCorrect) {
    return next(new AppError('Incorrect email or password', 401));
  }

  createSendToken(user, 200, res);
});

// --------------------
// LOGOUT
// --------------------
export const logout = (req, res) => {
  res.cookie('jwt', 'loggedout', {
    expires: new Date(Date.now() + 5 * 1000),
    httpOnly: true,
  });
  res.status(200).json({ status: 'success' });
};

// --------------------
// PROTECT: Route Guard
// --------------------
export const protect = catchAsync(async (req, res, next) => {
  let token;

  // Get token from header or cookie
  if (req.headers.authorization?.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.cookies.jwt) {
    token = req.cookies.jwt;
  }

  if (!token || token === 'loggedout') {
    return next(new AppError('You are not logged in!', 401));
  }

  // Verify token
  const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);

  // Check if user still exists
  const currentUser = await User.findById(decoded.id).select('+passwordChangedAt');
  if (!currentUser) {
    return next(new AppError('User no longer exists.', 401));
  }

  // Check if user changed password after token was issued
  if (currentUser.changedPasswordAfter(decoded.iat)) {
    return next(new AppError('Password changed recently. Please log in again.', 401));
  }

  req.user = currentUser;
  res.locals.user = currentUser;
  next();
});

// --------------------
// RESTRICT: Role-based Access Control
// --------------------
export const restrictTo = (...allowedRoles) => {
  return (req, res, next) => {
    const userRoles = req.user.role || [];
    const hasAccess = userRoles.some(role => allowedRoles.includes(role));
    if (!hasAccess) {
      return next(new AppError('You do not have permission for this action.', 403));
    }
    next();
  };
};

// --------------------
// UPDATE PASSWORD (User is Logged In)
// --------------------
export const updatePassword = catchAsync(async (req, res, next) => {
  const { passwordCurrent, password, passwordConfirm } = req.body;

  // Get user and validate current password
  const user = await User.findById(req.user.id).select('+password');
  if (!user || !(await user.correctPassword(passwordCurrent, user.password))) {
    return next(new AppError('Current password is incorrect.', 401));
  }

  // Set new password
  user.password = password;
  user.passwordConfirm = passwordConfirm;
  await user.save();

  createSendToken(user, 200, res);
});

// --------------------
// FORGOT PASSWORD
// --------------------
export const forgotPassword = catchAsync(async (req, res, next) => {
  const user = await User.findOne({ email: req.body.email });
  if (!user) {
    return next(new AppError('No user found with that email address.', 404));
  }

  const resetToken = user.createPasswordResetToken();
  await user.save({ validateBeforeSave: false });

  const resetURL = `${req.protocol}://${req.get('host')}/api/v1/auth/resetPassword/${resetToken}`;

  try {
    await sendEmail({
      email: user.email,
      subject: 'Your password reset token (valid for 10 minutes)',
      message: `Forgot your password? Click here to reset it: ${resetURL}`,
    });

    res.status(200).json({
      status: 'success',
      message: 'Token sent to email!',
    });
  } catch (err) {
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save({ validateBeforeSave: false });

    return next(new AppError('There was an error sending the email. Try again later.', 500));
  }
});

// --------------------
// RESET PASSWORD (With Token from Email)
// --------------------
export const resetPassword = catchAsync(async (req, res, next) => {
  // Hash token to compare with stored hashed token
  const hashedToken = crypto
    .createHash('sha256')
    .update(req.params.token)
    .digest('hex');

  // Find user with valid token
  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: Date.now() },
  });

  if (!user) {
    return next(new AppError('Token is invalid or has expired.', 400));
  }

  // Set new password
  user.password = req.body.password;
  user.passwordConfirm = req.body.passwordConfirm;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  await user.save();

  createSendToken(user, 200, res);
});
