import jwt from "jsonwebtoken";
import crypto from "crypto";
import { promisify } from "util";
import User from "../models/User.js";
import AppError from "../utils/AppError.js";
import catchAsync from "../utils/catchAsync.js";
import sendEmail from "../utils/email.js";
import logger from "../utils/logger.js";
import { stripe } from "./paymentController.js";

/**
 * Signs a JWT token for the given user ID.
 * @param {string} userId - The unique identifier of the user.
 * @returns {string} - The signed JWT token.
 */
const signToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });
};

/**
 * Creates and sends a JWT token in a cookie response.
 * @param {Object} user - The user object.
 * @param {number} statusCode - The HTTP status code for the response.
 * @param {Object} res - The Express response object.
 */
const createSendToken = (user, statusCode, res) => {
  const token = signToken(user._id);

  const cookieOptions = {
    expires: new Date(
      Date.now() +
        parseInt(process.env.JWT_COOKIE_EXPIRES_IN || "90", 10) *
          24 *
          60 *
          60 *
          1000
    ),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  };

  res.cookie("jwt", token, cookieOptions);

  user.password = undefined;

  // --- Check for onboarding redirection ---
  let redirectToOnboardingPath = null;
  if (user.role.includes("tasker") && !user.isTaskerOnboardingComplete) {
    redirectToOnboardingPath = "/onboarding/tasker"; // Frontend route for tasker onboarding
  }
  // Example: Add a similar check for providers if you have provider-specific onboarding
  else if (
    user.role.includes("provider") &&
    !user.isProviderOnboardingComplete
  ) {
    redirectToOnboardingPath = "/onboarding/provider";
  }

  res.status(statusCode).json({
    status: "success",
    token,
    data: {
      user,
      redirectToOnboarding: redirectToOnboardingPath, // Send this to the frontend
    },
  });
};

/**
 * Sends email verification to the user.
 */
const sendVerificationEmail = async (user, req) => {
  const verificationToken = user.createEmailVerificationToken();
  await user.save({ validateBeforeSave: false });

  // Use gygg.app for production URLs
  const frontendBaseURL = process.env.FRONTEND_URL || "http://localhost:3000";
  
  // Create verification URL that goes directly to frontend
  const verificationURL = `${frontendBaseURL}/verify-email?token=${verificationToken}`;
  
  // For backward compatibility, also create API URL (but prefer frontend URL)
  const backendBaseURL = process.env.BACKEND_URL || `${req.protocol}://${req.get("host")}`;
  const apiVerificationURL = `${backendBaseURL}/api/v1/users/verifyEmail/${verificationToken}`;

  // Plain text version
  const message = `Welcome to Gygg Platform!\n\nPlease verify your email by clicking this link:\n\n${verificationURL}\n\nThis link will expire in 10 minutes.\n\nIf you didn't create an account, please ignore this email.`;

  // HTML version with better formatting
  const html = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
  <meta charset="UTF-8">
  <title>Verify your email address - GYGG Platform.</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    /* Base & Font Styles */
    html, body {
      height: 100%;
      margin: 0;
      padding: 0;
      font-family: 'Inter', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    /* Page Layout */
    body {
      min-height: 100vh;
      width: 100vw;
      background-color: #00aaba;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
      overflow-x: hidden;
      box-sizing: border-box;
    }
    
    .page-wrapper {
      position: relative;
      width: 100%;
      padding-top: 16rem;
    }

    /* Email Card Component */
    .email-card {
      position: relative;
      background: #fff;
      width: 100%;
      margin:auto;
      max-width: 32rem;
      border-radius: 1.5rem;
      box-shadow: 0 16px 40px rgba(0,0,0,0.12);
      z-index: 10;
      overflow: hidden;
    }

    .card-body {
      padding: 2.5rem 1.5rem 2rem; /* Added generous top padding */
      text-align: center;
    }
    
    .icon-area {
      background-color: #eff6ff;
      border-radius: 0.75rem;
      padding: 1rem;
      margin-bottom: 2rem;
    }

    .email-icon {
      width: 12rem;
      height: 6rem;
      margin: auto; /* Centers the icon */
      display: block;
    }

    .card-body h1 {
      font-size: 1.5rem;
      font-weight: 700;
      color: #1f2937;
      margin-bottom: 0.75rem;
    }

    .card-body .welcome-text {
      color: #4b5563;
      margin-bottom: 0.5rem;
    }
    
    .card-body .gold-heading {
      color: #da9a3d;
      font-weight: 900;
    }

    .card-body .instructions {
      color: #6b7280;
      margin-bottom: 1.5rem;
    }

    .card-body .sub-instructions {
        color: #6b7280;
        margin-top: 1.5rem;
        margin-bottom: 0.5rem;
    }
    
    .card-body .disclaimer {
      color: #9ca3af;
      font-size: 0.875rem;
      margin-top: 2rem;
    }

    .verify-button {
      display: inline-block;
      box-sizing: border-box;
      width: 100%;
      background: #00aaba;
      color: #fff;
      font-weight: 700;
      padding: 0.75rem 3rem;
      border: none;
      border-radius: 999px;
      box-shadow: 0 4px 20px rgba(49, 88, 190, 0.14);
      cursor: pointer;
      font-size: 1.05rem;
      text-decoration: none;
      transition: all 0.3s cubic-bezier(.4,0,.2,1);
    }
    .verify-button:hover {
      background: #008b8b;
      transform: translateY(-2px);
      box-shadow: 0 8px 32px rgba(49, 88, 190, 0.18);
    }

    .url-display {
      word-break: break-all;
      background-color: #f0f0f0;
      padding: 10px;
      border-radius: 4px;
      font-size: 14px;
      margin: 15px 0;
    }

    .expiry-notice {
      font-weight: bold;
      color: #d99633;
    }

    .card-footer {
      background-color: #f9fafb;
      padding: 1rem 1.5rem;
      border-top: 1px solid #e5e7eb;
      text-align: center;
      color: #6b7280;
      font-size: 0.75rem;
    }
    
    /* Responsive Styles */
    @media (min-width: 768px) {
      .card-body {
        padding-left: 3rem;
        padding-right: 3rem;
      }
      .card-body h1 {
        font-size: 1.875rem;
      }
      .card-footer {
        padding-left: 3rem;
        padding-right: 3rem;
      }
    }

    /* Decorative elements */
    .absolute { position: absolute; }
    .-top-10 { top: -2.5rem; }
    .-left-20 { left: -5rem; }
    .-bottom-20 { bottom: -5rem; }
    .-right-20 { right: -5rem; }
    .-right-24 { right: -6rem; }
    .top-1\/2 { top: 50%; }
    .bottom-5 { bottom: 1.25rem; }
    .right-5 { right: 1.25rem; }
    .-rotate-45 { transform: rotate(-45deg); }
    .rotate-45 { transform: rotate(45deg); }
    .rotate-12 { transform: rotate(12deg); }
    .-rotate-12 { transform: rotate(-12deg); }
    .w-24 { width: 6rem; }
    .h-32 { height: 8rem; }
    .w-48 { width: 12rem; }
    .h-48 { height: 12rem; }
    .w-80 { width: 20rem; }
    .h-80 { height: 20rem; }
  </style>
</head>
<body>
<main class="page-wrapper">
  <!-- Background Decorations -->
  <svg class="absolute -top-10 -left-20 w-80 h-80 -rotate-45" viewBox="0 0 100 60" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M0 5C0 2.23858 2.23858 0 5 0H95C97.7614 0 100 2.23858 100 5V55C100 57.7614 97.7614 60 95 60H5C2.23858 60 0 57.7614 0 55V5Z" fill="white" fill-opacity="0.1"/><path d="M100 5L50 32.5L0 5" stroke="white" stroke-opacity="0.2" stroke-width="2"/></svg>
  <svg class="absolute -bottom-20 -right-20 w-80 h-80 rotate-45" viewBox="0 0 100 60" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M0 5C0 2.23858 2.23858 0 5 0H95C97.7614 0 100 2.23858 100 5V55C100 57.7614 97.7614 60 95 60H5C2.23858 60 0 57.7614 0 55V5Z" fill="white" fill-opacity="0.1"/><path d="M100 5L50 32.5L0 5" stroke="white" stroke-opacity="0.2" stroke-width="2"/></svg>
  <svg class="absolute top-1/2 -right-24 w-48 h-48 rotate-12" viewBox="0 0 100 60" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M0 5C0 2.23858 2.23858 0 5 0H95C97.7614 0 100 2.23858 100 5V55C100 57.7614 97.7614 60 95 60H5C2.23858 60 0 57.7614 0 55V5Z" fill="white" fill-opacity="0.1"/><path d="M100 5L50 32.5L0 5" stroke="white" stroke-opacity="0.2" stroke-width="2"/></svg>
  <svg class="absolute bottom-5 right-5 w-24 h-32 -rotate-12" viewBox="0 0 100 120" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 10C5 4.47715 9.47715 0 15 0H85C90.5228 0 95 4.47715 95 10V70H5V10Z" fill="white" fill-opacity="0.1"/><path d="M70 30L70 40" stroke="#FFFFFF" stroke-opacity="0.3" stroke-width="5" stroke-linecap="round"/><rect x="45" y="65" width="10" height="55" rx="2" fill="white" fill-opacity="0.1"/><path d="M100 85H0" stroke="white" stroke-opacity="0.1" stroke-width="10"/><path d="M85 0L85 20" stroke="#FFFFFF" stroke-opacity="0.3" stroke-width="8" stroke-linecap="round"/></svg>

  <div class="email-card">
    <div class="card-body">
      <div class="icon-area">
        <svg viewBox="0 0 200 100" class="email-icon" xmlns="http://www.w3.org/2000/svg">
          <defs><linearGradient id="paperGradient" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#f0f9ff" stop-opacity="1" /><stop offset="100%" stop-color="#e0f2fe" stop-opacity="1" /></linearGradient></defs>
          <path d="M20 35 H180 V85 H20 Z" fill="#93c5fd" /><path d="M20 35 L100 65 L180 35" fill="#60a5fa" />
          <path d="M35 45 H165 V10 H35 Z" fill="url(#paperGradient)" stroke="#93C5FD" stroke-width="1" transform="rotate(-5 100 47.5)" />
          <path d="M50 22 H150 M50 28 H150 M50 34 H120" stroke="#dbeafe" stroke-width="1.5" transform="rotate(-5 100 47.5)" />
          <circle cx="161" cy="75" r="22" fill="#10B981" /><path d="M149 75 L156 82 L171 67"
stroke="white" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </div>
      <h1>Verify your email address</h1>
      <p class="welcome-text">
        Welcome to <span class="gold-heading">GYGG Platform</span>
      </p>
      <p class="instructions">
        Thank you for signing up. To complete your registration and verify your email address, please click the button below:
      </p>
      <a href="${verificationURL}" class="verify-button">Verify My Email</a>
      <p class="sub-instructions">
        If the button doesn't work, you can copy and paste this link into your browser:
      </p>
      <div class="url-display">${verificationURL}</div>
      <p class="expiry-notice">This link will expire in 10 minutes.</p>
      <p class="disclaimer">
       If you didn't create an account with us, please ignore this email.
      </p>
    </div>
    <div class="card-footer">
      <p>© ${new Date().getFullYear()} Gygg Platform. All rights reserved.</p>
      <p>This is an automated message, please do not reply to this email.</p>
    </div>
  </div>
</main>
</body>
</html>
  `;

  try {
    await sendEmail({
      email: user.email,
      subject: "Gygg Platform - Verify Your Email Address",
      message,
      html,
    });
    logger.info(`Verification email sent to ${user.email}`);
  } catch (error) {
    logger.error(`Failed to send verification email to ${user.email}`, {
      error,
    });
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;
    await user.save({ validateBeforeSave: false });
  }
};

/**
 * Handles user signup functionality.
 * @route POST /api/v1/auth/signup
 * @access Public
 */
export const signup = catchAsync(async (req, res, next) => {
  try {
    const newUser = await User.create(req.body);
    await sendVerificationEmail(newUser, req); // Send verification email after user creation
    // Generate JWT token
    const token = signToken(newUser._id);
    res.status(201).json({
      status: "success",
      data: { user: newUser },
      token,
    });
  } catch (err) {
    // Handle duplicate key errors
    if (err.code === 11000) {
      if (err.keyPattern && err.keyPattern.email) {
        return res.status(400).json({
          status: "fail",
          message:
            "This email address is already registered. Please use a different email or try logging in.",
        });
      }
      if (err.keyPattern && err.keyPattern.phoneNo) {
        return res.status(400).json({
          status: "fail",
          message:
            "This phone number is already registered. Please use a different phone number.",
        });
      }
      // Generic duplicate key error
      return res.status(400).json({
        status: "fail",
        message:
          "This information is already registered. Please check your email and phone number.",
      });
    }

    // Handle validation errors
    if (err.name === "ValidationError") {
      const errors = Object.values(err.errors).map((e) => e.message);
      return res.status(400).json({
        status: "fail",
        message: errors.join(". "),
      });
    }

    return next(err);
  }
});

/**
 * Handles user login functionality.
 * @route POST /api/v1/auth/login
 * @access Public
 */
export const login = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;

  logger.info(`Login attempt received for email: ${email}`, {
    requestBody: req.body,
  });

  if (!email || !password) {
    return next(new AppError("Please provide email and password!", 400));
  }

  // Select onboarding flags along with password
  const user = await User.findOne({ email }).select(
    "+password +isTaskerOnboardingComplete +isProviderOnboardingComplete"
  );

  if (!user || !(await user.correctPassword(password, user.password))) {
    logger.warn(
      `Login attempt failed for email: ${email} (Incorrect credentials)`
    );
    return next(new AppError("Incorrect email or password", 401));
  }

  logger.info(`User found for login attempt: ${user.email}, ID: ${user._id}`);

  if (!user.isEmailVerified) {
    return res
      .status(401)
      .json({
        status: "fail",
        message: "Please verify your email before logging in.",
      });
  }

  logger.info(`User logged in successfully: ${user.email}`);
  
  // Determine redirection based on onboarding completion status
  let redirectToOnboarding = null;
  
  // Check if user needs onboarding
  const needsTaskerOnboarding = user.role.includes("tasker") && !user.isTaskerOnboardingComplete;
  const needsProviderOnboarding = user.role.includes("provider") && !user.isProviderOnboardingComplete;
  
  if (needsTaskerOnboarding && needsProviderOnboarding) {
    // User has both roles and needs both onboardings - let them choose or default to tasker
    redirectToOnboarding = "/onboarding/tasker";
  } else if (needsTaskerOnboarding) {
    redirectToOnboarding = "/onboarding/tasker";
  } else if (needsProviderOnboarding) {
    redirectToOnboarding = "/onboarding/provider";
  }
  // If no onboarding needed, redirectToOnboarding remains null
  
  const token = signToken(user._id);
  res.status(200).json({
    status: "success",
    data: { user, token },
    redirectToOnboarding,
  });
});

/**
 * Logs the user out by clearing the JWT cookie.
 * @route GET /api/v1/auth/logout
 * @access Public
 */
export const logout = (req, res) => {
  console.log("Logout route hit");
  res
    .status(200)
    .json({ status: "success", message: "Logged out successfully." });
};

/**
 * Protects routes and ensures the user is authenticated.
 * @route Middleware
 * @access Private
 */
export const protect = catchAsync(async (req, res, next) => {
  let token;

  if (req.headers.authorization?.startsWith("Bearer")) {
    token = req.headers.authorization.split(" ")[1];
  } else if (req.cookies.jwt) {
    token = req.cookies.jwt;
  }

  if (!token || token === "loggedout") {
    return next(new AppError("You are not logged in!", 401));
  }

  const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);

  const currentUser = await User.findById(decoded.id).select(
    "+passwordChangedAt"
  );
  if (!currentUser) {
    return next(new AppError("User no longer exists.", 401));
  }

  if (currentUser.changedPasswordAfter(decoded.iat)) {
    return next(
      new AppError("Password changed recently. Please log in again.", 401)
    );
  }

  req.user = currentUser;
  res.locals.user = currentUser;
  next();
});

/**
 * Restricts access to specific roles.
 */
export const restrictTo = (...allowedRoles) => {
  return (req, res, next) => {
    const userRoles = req.user.role || [];

    const hasAccess = userRoles.some((role) => allowedRoles.includes(role));

    if (!hasAccess) {
      return next(
        new AppError("You do not have permission for this action.", 403)
      );
    }
    next();
  };
};

/**
 * Verifies the user's email using the token.
 * @route GET /api/v1/users/verifyEmail/:token
 */
export const verifyEmail = catchAsync(async (req, res, next) => {
  const hashedToken = crypto
    .createHash("sha256")
    .update(req.params.token)
    .digest("hex");

  // First, check if user exists with this token (regardless of expiry)
  const userWithToken = await User.findOne({
    emailVerificationToken: hashedToken,
  });

  if (!userWithToken) {
    logger.warn("Email verification failed: Token not found.", {
      tokenAttempt: req.params.token,
    });
    
    // Redirect to frontend with error message
    const frontendURL = process.env.FRONTEND_URL || "http://localhost:3000";
    return res.redirect(302, `${frontendURL}/verify-email?error=invalid_token&message=Token not found. Please request a new verification email.`);
  }

  // Check if token has expired
  if (userWithToken.emailVerificationExpires <= Date.now()) {
    logger.warn("Email verification failed: Token expired.", {
      tokenAttempt: req.params.token,
      userEmail: userWithToken.email,
      expiredAt: new Date(userWithToken.emailVerificationExpires),
    });
    
    // Clean up expired token
    userWithToken.emailVerificationToken = undefined;
    userWithToken.emailVerificationExpires = undefined;
    await userWithToken.save({ validateBeforeSave: false });
    
    // Redirect to frontend with expired token message
    const frontendURL = process.env.FRONTEND_URL || "http://localhost:3000";
    return res.redirect(302, `${frontendURL}/verify-email?error=expired_token&message=Token has expired. Please request a new verification email.&email=${encodeURIComponent(userWithToken.email)}`);
  }

  // Check if email is already verified
  if (userWithToken.isEmailVerified) {
    logger.info("Email verification attempted for already verified user.", {
      userEmail: userWithToken.email,
    });
    
    // Redirect to login with success message
    const frontendURL = process.env.FRONTEND_URL || "http://localhost:3000";
    return res.redirect(302, `${frontendURL}/login?message=Email already verified. You can now log in.`);
  }

  // Token is valid and not expired - verify the email
  userWithToken.isEmailVerified = true;
  userWithToken.emailVerificationToken = undefined;
  userWithToken.emailVerificationExpires = undefined;
  await userWithToken.save();

  logger.info(`Email verified successfully for user ${userWithToken._id}`);

  // Redirect to frontend login page after successful verification
  const frontendURL = process.env.FRONTEND_URL || "http://localhost:3000";
  return res.redirect(302, `${frontendURL}/login?message=Email verified successfully! You can now log in.`);
});

/**
 * Resends the email verification token to the user (no login required).
 * @route POST /api/v1/users/resendVerificationEmail
 */
export const resendVerificationEmail = catchAsync(async (req, res, next) => {
  const { email } = req.body;
  if (!email) {
    return next(new AppError("Please provide your email address.", 400));
  }
  const user = await User.findOne({ email });
  if (!user) {
    // For security, do not reveal if user exists
    return res
      .status(200)
      .json({
        status: "success",
        message: "If that email exists, a verification link has been sent.",
      });
  }
  if (user.isEmailVerified) {
    return next(new AppError("Your email is already verified.", 400));
  }
  await sendVerificationEmail(user, req);
  res.status(200).json({
    status: "success",
    message: "Verification email resent. Please check your inbox.",
  });
});

export const updatePassword = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user.id).select("+password");
  const { passwordCurrent, password, passwordConfirm } = req.body;

  if (
    !passwordCurrent ||
    !(await user.correctPassword(passwordCurrent, user.password))
  ) {
    return next(new AppError("Your current password is incorrect", 401));
  }

  // Mongoose validation for passwordConfirm runs automatically if passwordConfirm is in schema
  // and the schema validator is correctly defined.
  user.password = password;
  user.passwordConfirm = passwordConfirm; // Schema validator will check if it matches user.password
  await user.save(); // Use save() to trigger pre-save middleware (hashing, passwordChangedAt)

  // Log user in, send JWT
  createSendToken(user, 200, res);
});

// --- Forgot Password ---
export const forgotPassword = catchAsync(async (req, res, next) => {
  const { email } = req.body;
  if (!email) {
    return next(new AppError("Please provide your email address.", 400));
  }
  const user = await User.findOne({ email });
  if (!user) {
    // For security, do not reveal if user exists
    return res
      .status(200)
      .json({
        status: "success",
        message: "If that email exists, a reset link has been sent.",
      });
  }
  const resetToken = user.createPasswordResetToken();
  await user.save({ validateBeforeSave: false });
  
  // Use gygg.app for production URLs
  const frontendBaseURL = process.env.FRONTEND_URL || "http://localhost:3000";
  const resetURL = `${frontendBaseURL}/reset-password?token=${resetToken}`;
  
  // For backward compatibility, also create API URL (but prefer frontend URL)
  const backendBaseURL = process.env.BACKEND_URL || `${req.protocol}://${req.get("host")}`;
  const apiResetURL = `${backendBaseURL}/api/v1/users/resetPassword/${resetToken}`;

  // Plain text version
  const message = `Forgot your password? Reset it here: ${resetURL}\n\nIf you didn't request this password reset, please ignore this email.`;

  // HTML version with better formatting
  const html = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
  <meta charset="UTF-8">
  <title>Password Reset Request - GYGG Platform</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    html, body {
      height: 100%;
      margin: 0;
      padding: 0;
      font-family: 'Inter', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    body {
      min-height: 100vh;
      width: 100vw;
      background-color: #00aaba;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
      overflow-x: hidden;
      box-sizing: border-box;
    }
    .page-wrapper {
      position: relative;
      width: 100%;
      padding-top: 16rem;
    }
    .email-card {
      position: relative;
      background: #fff;
      width: 100%;
      margin:auto;
      max-width: 32rem;
      border-radius: 1.5rem;
      box-shadow: 0 16px 40px rgba(0,0,0,0.12);
      z-index: 10;
      overflow: hidden;
    }
    .gold-heading {
      color: #da9a3d;
      font-weight: 900;
    }
    .card-body {
      padding: 2.5rem 1.5rem 2rem;
      text-align: center;
    }
    .icon-area {
      background-color: #eff6ff;
      border-radius: 0.75rem;
      padding: 1rem;
      margin-bottom: 2rem;
    }
    .email-icon {
      width: 12rem;
      height: 6rem;
      margin: auto;
      display: block;
    }
    .card-body h1 {
      font-size: 1.5rem;
      font-weight: 700;
      color: #1f2937;
      margin-bottom: 0.75rem;
    }
    .card-body .instructions {
      color: #6b7280;
      margin-bottom: 1.5rem;
    }
    .reset-button {
      display: inline-block;
      box-sizing: border-box;
      width: 100%;
      background: #00aaba;
      color: #fff;
      font-weight: 700;
      padding: 0.75rem 3rem;
      border: none;
      border-radius: 999px;
      box-shadow: 0 4px 20px rgba(49, 88, 190, 0.14);
      cursor: pointer;
      font-size: 1.05rem;
      text-decoration: none;
      transition: all 0.3s cubic-bezier(.4,0,.2,1);
      margin-bottom: 1.5rem;
      margin-top: 1rem;
    }
    .reset-button:hover {
      background: #008b8b;
      transform: translateY(-2px);
      box-shadow: 0 8px 32px rgba(49, 88, 190, 0.18);
    }
    .url-display {
      word-break: break-all;
      background-color: #f0f0f0;
      padding: 10px;
      border-radius: 4px;
      font-size: 14px;
      margin: 15px 0;
    }
    .expiry-notice {
      font-weight: bold;
      color: #d99633;
    }
    .card-body .disclaimer {
      color: #9ca3af;
      font-size: 0.875rem;
      margin-top: 2rem;
    }
    .card-footer {
      background-color: #f9fafb;
      padding: 1rem 1.5rem;
      border-top: 1px solid #e5e7eb;
      text-align: center;
      color: #6b7280;
      font-size: 0.75rem;
    }
    @media (min-width: 768px) {
      .card-body {
        padding-left: 3rem;
        padding-right: 3rem;
      }
      .card-body h1 {
        font-size: 1.875rem;
      }
      .card-footer {
        padding-left: 3rem;
        padding-right: 3rem;
      }
    }
    /* Decorative SVG shapes reused */
    .absolute { position: absolute; }
    .-top-10 { top: -2.5rem; }
    .-left-20 { left: -5rem; }
    .-bottom-20 { bottom: -5rem; }
    .-right-20 { right: -5rem; }
    .-right-24 { right: -6rem; }
    .top-1\/2 { top: 50%; }
    .bottom-5 { bottom: 1.25rem; }
    .right-5 { right: 1.25rem; }
    .-rotate-45 { transform: rotate(-45deg); }
    .rotate-45 { transform: rotate(45deg); }
    .rotate-12 { transform: rotate(12deg); }
    .-rotate-12 { transform: rotate(-12deg); }
    .w-24 { width: 6rem; }
    .h-32 { height: 8rem; }
    .w-48 { width: 12rem; }
    .h-48 { height: 12rem; }
    .w-80 { width: 20rem; }
    .h-80 { height: 20rem; }
    /* Utility classes for spacing/text/color */
    .mb-1-5 { margin-bottom: 1.5rem; }
    .mt-1 { margin-top: 1rem; }
    .mb-2 { margin-bottom: 2rem; }
    .mb-0-75 { margin-bottom: 0.75rem; }
    .text-center { text-align: center; }
    .text-color-primary { color: #00aaba; font-weight: 600; }
  </style>
</head>
<body>
<main class="page-wrapper">
  <!-- Background Decorations -->
  <svg class="absolute -top-10 -left-20 w-80 h-80 -rotate-45" viewBox="0 0 100 60" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M0 5C0 2.23858 2.23858 0 5 0H95C97.7614 0 100 2.23858 100 5V55C100 57.7614 97.7614 60 95 60H5C2.23858 60 0 57.7614 0 55V5Z" fill="white" fill-opacity="0.1"/><path d="M100 5L50 32.5L0 5" stroke="white" stroke-opacity="0.2" stroke-width="2"/></svg>
  <svg class="absolute -bottom-20 -right-20 w-80 h-80 rotate-45" viewBox="0 0 100 60" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M0 5C0 2.23858 2.23858 0 5 0H95C97.7614 0 100 2.23858 100 5V55C100 57.7614 97.7614 60 95 60H5C2.23858 60 0 57.7614 0 55V5Z" fill="white" fill-opacity="0.1"/><path d="M100 5L50 32.5L0 5" stroke="white" stroke-opacity="0.2" stroke-width="2"/></svg>
  <svg class="absolute top-1/2 -right-24 w-48 h-48 rotate-12" viewBox="0 0 100 60" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M0 5C0 2.23858 2.23858 0 5 0H95C97.7614 0 100 2.23858 100 5V55C100 57.7614 97.7614 60 95 60H5C2.23858 60 0 57.7614 0 55V5Z" fill="white" fill-opacity="0.1"/><path d="M100 5L50 32.5L0 5" stroke="white" stroke-opacity="0.2" stroke-width="2"/></svg>
  <svg class="absolute bottom-5 right-5 w-24 h-32 -rotate-12" viewBox="0 0 100 120" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 10C5 4.47715 9.47715 0 15 0H85C90.5228 0 95 4.47715 95 10V70H5V10Z" fill="white" fill-opacity="0.1"/><path d="M70 30L70 40" stroke="#FFFFFF" stroke-opacity="0.3" stroke-width="5" stroke-linecap="round"/><rect x="45" y="65" width="10" height="55" rx="2" fill="white" fill-opacity="0.1"/><path d="M100 85H0" stroke="white" stroke-opacity="0.1" stroke-width="10"/><path d="M85 0L85 20" stroke="#FFFFFF" stroke-opacity="0.3" stroke-width="8" stroke-linecap="round"/></svg>
  <div class="email-card">
    <div class="card-body">
      <div class="icon-area">
        <svg viewBox="0 0 200 100" class="email-icon" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="paperGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stop-color="#f0f9ff" stop-opacity="1" />
              <stop offset="100%" stop-color="#e0f2fe" stop-opacity="1" />
            </linearGradient>
          </defs>
          <path d="M20 35 H180 V85 H20 Z" fill="#93c5fd" />
          <path d="M20 35 L100 65 L180 35" fill="#60a5fa" />
          <path d="M35 45 H165 V10 H35 Z" fill="url(#paperGradient)" stroke="#93C5FD" stroke-width="1" transform="rotate(-5 100 47.5)" />
          <path d="M50 22 H150 M50 28 H150 M50 34 H120" stroke="#dbeafe" stroke-width="1.5" transform="rotate(-5 100 47.5)" />
        </svg>
      </div>
      <h1>Password Reset Request</h1>
      <p class="instructions">
        We received a request to reset your password for your <span class="gold-heading">GYGG Platform</span> account.
        To reset your password, please click the button below:
      </p>
      <a href="${resetURL}" class="reset-button mt-1 mb-1-5">Reset My Password</a>
      <p class="instructions mb-1-5">
        If the button doesn't work, you can copy and paste this link into your browser:
      </p>
      <div class="url-display">${resetURL}</div>
      <p class="expiry-notice">This link will expire in 10 minutes.</p>
      <p class="disclaimer">
        If you didn't request a password reset, you can safely ignore this email or contact support if you have concerns.
      </p>
    </div>
    <div class="card-footer">
      <p>© ${new Date().getFullYear()} Gygg Platform. All rights reserved.</p>
      <p>This is an automated message, please do not reply to this email.</p>
    </div>
  </div>
</main>
</body>
</html>
  `;

  try {
    await sendEmail({
      email: user.email,
      subject: "Gygg Platform - Password Reset",
      message,
      html,
    });
    res
      .status(200)
      .json({
        status: "success",
        message: "If that email exists, a reset link has been sent.",
      });
  } catch (err) {
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save({ validateBeforeSave: false });
    return next(
      new AppError(
        "There was an error sending the email. Try again later.",
        500
      )
    );
  }
});

// --- Reset Password ---
export const resetPassword = catchAsync(async (req, res, next) => {
  const hashedToken = crypto
    .createHash("sha256")
    .update(req.params.token)
    .digest("hex");
  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: Date.now() },
  });
  if (!user) {
    return next(new AppError("Token is invalid or has expired.", 400));
  }
  user.password = req.body.password;
  user.passwordConfirm = req.body.passwordConfirm;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  await user.save();
  createSendToken(user, 200, res);
});
