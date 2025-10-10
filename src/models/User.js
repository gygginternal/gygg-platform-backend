// models/User.js

import mongoose from "mongoose";
import validator from "validator";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import logger from "../utils/logger.js";
import { sanitizeMessageContent } from "../utils/sanitizer.js";

// ---------------- Address Schema ---------------- //
const addressSchema = new mongoose.Schema(
  {
    street: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    postalCode: { type: String, trim: true },
    country: { type: String, trim: true },
  },
  { _id: false }
);

// ---------------- Availability Schema ---------------- //
const availabilitySchema = new mongoose.Schema(
  {
    monday: { type: Boolean, default: true },
    tuesday: { type: Boolean, default: true },
    wednesday: { type: Boolean, default: true },
    thursday: { type: Boolean, default: true },
    friday: { type: Boolean, default: true },
    saturday: { type: Boolean, default: false },
    sunday: { type: Boolean, default: false },
  },
  { _id: false }
);

// ---------------- Album Photo Schema ---------------- //
const albumPhotoSchema = new mongoose.Schema(
  {
    url: { type: String, required: true }, // S3 Object URL (or CloudFront URL)
    key: { type: String, required: true, select: false }, // S3 Object Key (for deletion)
    caption: { type: String, trim: true, maxlength: 50 },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

// ---------------- User Schema ---------------- //
const userSchema = new mongoose.Schema(
  {
    // Basic Info
    firstName: {
      type: String,
      // required: [true, "First name is required"], // collected on Onboarding
      trim: true,
    },
    lastName: {
      type: String,
      // required: [true, "Last name is required"], // collected on Onboarding
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      validate: [validator.isEmail, "Please provide a valid email"],
    },
    phoneNo: {
      type: String,
      required: [true, "Phone number is required"],
      trim: true,
      unique: true, // Make phone numbers unique
      sparse: true, // Allows multiple null/undefined values if not provided
      validate: {
        validator: function(v) {
          if (!v) return false; // Don't allow empty values since it's required
          // Simplified validation - just make sure it starts with +1
          return /^\+1\d+$/.test(v);
        },
        message: props => `${props.value} is not a valid phone number. Phone number must start with +1.`
      }
    },

    dateOfBirth: {
      type: Date,
      // required: [true, "Date of birth is required"], // Make required if always needed
      validate: { // Custom validator for age
          validator: function(value) {
              if (!value) return true; // Allow if not provided (unless it's required)
              const today = new Date();
              const birthDate = new Date(value);
              let age = today.getFullYear() - birthDate.getFullYear();
              const m = today.getMonth() - birthDate.getMonth();
              if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
                  age--;
              }
              return age >= 50; // Must be 50 or older
          },
          message: props => `User must be at least 50 years old. You entered a date that makes you younger.`
      }
    },

    // Authentication
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [8, "Password must be at least 8 characters long"],
      validate: {
        validator: function(password) {
          // Password strength validation
          const hasUpperCase = /[A-Z]/.test(password);
          const hasLowerCase = /[a-z]/.test(password);
          const hasNumbers = /\d/.test(password);
          const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);
          
          return hasUpperCase && hasLowerCase && hasNumbers && hasSpecialChar;
        },
        message: "Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character (!@#$%^&*(),.?\":{}|<>)"
      },
      select: false,
    },
    passwordConfirm: {
      type: String,
      validate: {
        validator: function (el) {
          if (!this.isModified("password") && !this.isNew) return true;
          return el === this.password;
        },
        message: "Passwords do not match",
      },
    },
    passwordChangedAt: {
      type: Date,
      select: false,
    },
    passwordResetToken: String,
    passwordResetExpires: Date,

    // Role-based Access
    role: {
      type: [String],
      enum: ["tasker", "provider", "admin"],
      required: [true, "At least one role is required"],
    },

    // Profile Image & Album
    profileImage: { type: String, default: "default.jpg" }, // S3/CloudFront URL
    profileImageKey: { type: String, select: false }, // S3 Key for deletion
    album: [albumPhotoSchema], // User's photo gallery

    // Profile Details
    address: addressSchema,
    bio: {
      type: String,
      trim: true,
      maxlength: [750, "Bio cannot be more than 750 characters"],
    },
    hobbies: [{ type: String, trim: true }],
    skills: [{ type: String, trim: true }],
    peoplePreference: [
      {
        type: String,
        trim: true,
        maxlength: [300, "People preference cannot be more than 300 characters"],
      },
    ],

    // Availability and Rate
    availability: {
      type: availabilitySchema,
      default: () => ({}),
    },
    ratePerHour: {
      type: Number,
      default: 0,
    },

    // Ratings
    rating: {
      type: Number,
      default: 0,
      min: [0, "Rating must be at least 0"],
      max: [5, "Rating cannot be more than 5"],
    },
    ratingCount: {
      type: Number,
      default: 0,
    },

    // Verification
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    emailVerificationToken: String,
    emailVerificationExpires: Date,
    emailVerificationAttempts: {
      type: Number,
      default: 0,
    },
    emailVerificationCooldownUntil: Date,

    // Stripe Integration
    stripeAccountId: String,
    stripeChargesEnabled: {
      type: Boolean,
      default: false,
      select: false,
    },
    stripePayoutsEnabled: {
      type: Boolean,
      default: false,
      select: false,
    },

    // Account Status
    active: {
      type: Boolean,
      default: true,
    },

    // Social Graph
    followers: [{
      type: mongoose.Schema.ObjectId,
      ref: 'User',
    }],
    following: [{
      type: mongoose.Schema.ObjectId,
      ref: 'User',
    }],

    // Verification Badge
    isVerified: {
      type: Boolean,
      default: false,
    },

    // Onboarding Flags
    isTaskerOnboardingComplete: {
      type: Boolean,
      default: false,
      select: true,
    },
    isProviderOnboardingComplete: {
      type: Boolean,
      default: false,
      select: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ---------------- Virtuals ---------------- //
userSchema.virtual("fullName").get(function () {
  return `${this.firstName} ${this.lastName}`;
});

// ---------------- Indexes ---------------- //
userSchema.index({ stripeAccountId: 1 });
userSchema.index(
  { 
    firstName: "text", 
    lastName: "text", 
    fullName: "text", 
    peoplePreference: "text", 
    bio: "text",
    skills: "text"
  },
  {
    weights: { 
      firstName: 15,
      lastName: 15,
      fullName: 20,
      peoplePreference: 10, 
      bio: 5,
      skills: 8
    },
    name: "TextSearchIndex",
  }
);

// ---------------- Document Middleware ---------------- //

// Pre-save middleware to sanitize user-generated content
userSchema.pre("save", function(next) {
  // Sanitize bio field
  if (this.bio && typeof this.bio === 'string') {
    this.bio = sanitizeMessageContent(this.bio);
  }
  
  // Sanitize peoplePreference array fields
  if (this.peoplePreference && Array.isArray(this.peoplePreference)) {
    this.peoplePreference = this.peoplePreference.map(pref => 
      typeof pref === 'string' ? sanitizeMessageContent(pref) : pref
    );
  }
  
  // Sanitize skills array fields
  if (this.skills && Array.isArray(this.skills)) {
    this.skills = this.skills.map(skill => 
      typeof skill === 'string' ? sanitizeMessageContent(skill) : skill
    );
  }
  
  // Sanitize hobbies array fields
  if (this.hobbies && Array.isArray(this.hobbies)) {
    this.hobbies = this.hobbies.map(hobby => 
      typeof hobby === 'string' ? sanitizeMessageContent(hobby) : hobby
    );
  }
  
  // Sanitize caption fields in album photos
  if (this.album && Array.isArray(this.album)) {
    this.album = this.album.map(photo => {
      if (photo.caption && typeof photo.caption === 'string') {
        photo.caption = sanitizeMessageContent(photo.caption);
      }
      return photo;
    });
  }
  
  next();
});

// Encrypt password before saving
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 12);
  this.passwordConfirm = undefined;
  next();
});

// Update passwordChangedAt timestamp
userSchema.pre("save", function (next) {
  if (!this.isModified("password") || this.isNew) return next();
  this.passwordChangedAt = Date.now() - 1000;
  next();
});

// ---------------- Query Middleware ---------------- //

// Filter out inactive users
userSchema.pre(/^find/, function (next) {
  this.find({ active: { $ne: false } });
  next();
});

// ---------------- Instance Methods ---------------- //

// Compare passwords
userSchema.methods.correctPassword = async function (candidatePassword, userPassword) {
  return await bcrypt.compare(candidatePassword, userPassword);
};

// Check if password was changed after JWT issued
userSchema.methods.changedPasswordAfter = function (JWTTimestamp) {
  if (this.passwordChangedAt) {
    const changedTimestamp = parseInt(this.passwordChangedAt.getTime() / 1000, 10);
    return JWTTimestamp < changedTimestamp;
  }
  return false;
};

// Generate email verification token with rate limiting
userSchema.methods.createEmailVerificationToken = function () {
  // Check if user is in cooldown period
  if (this.emailVerificationCooldownUntil && this.emailVerificationCooldownUntil > Date.now()) {
    const remainingTime = Math.ceil((this.emailVerificationCooldownUntil - Date.now()) / 1000 / 60);
    throw new Error(`Too many verification attempts. Please wait ${remainingTime} minutes before requesting another verification email.`);
  }

  // Reset attempts if cooldown period has passed
  if (this.emailVerificationCooldownUntil && this.emailVerificationCooldownUntil <= Date.now()) {
    this.emailVerificationAttempts = 0;
    this.emailVerificationCooldownUntil = undefined;
  }

  // Check attempt limit
  if (this.emailVerificationAttempts >= 10) {
    // Set 10-minute cooldown
    this.emailVerificationCooldownUntil = Date.now() + 10 * 60 * 1000;
    throw new Error('Too many verification attempts. Please wait 10 minutes before requesting another verification email.');
  }

  // Clear old token (replace with new one)
  this.emailVerificationToken = undefined;
  this.emailVerificationExpires = undefined;

  // Generate new token
  const verificationToken = crypto.randomBytes(32).toString("hex");

  this.emailVerificationToken = crypto
    .createHash("sha256")
    .update(verificationToken)
    .digest("hex");

  this.emailVerificationExpires = Date.now() + 10 * 60 * 1000;

  // Increment attempt counter
  this.emailVerificationAttempts = (this.emailVerificationAttempts || 0) + 1;

  logger.debug(
    `Generated email verification token (raw): ${verificationToken} for user ${this._id}. Attempt ${this.emailVerificationAttempts}/10`
  );

  return verificationToken;
};

// Reset email verification attempts (called after successful verification)
userSchema.methods.resetEmailVerificationAttempts = function () {
  this.emailVerificationAttempts = 0;
  this.emailVerificationCooldownUntil = undefined;
  this.emailVerificationToken = undefined;
  this.emailVerificationExpires = undefined;
  
  logger.debug(`Reset email verification attempts for user ${this._id}`);
};

// Check email verification rate limit status
userSchema.methods.getEmailVerificationStatus = function () {
  const now = Date.now();
  const isInCooldown = this.emailVerificationCooldownUntil && this.emailVerificationCooldownUntil > now;
  const remainingAttempts = Math.max(0, 10 - (this.emailVerificationAttempts || 0));
  
  let cooldownMinutes = 0;
  if (isInCooldown) {
    cooldownMinutes = Math.ceil((this.emailVerificationCooldownUntil - now) / 1000 / 60);
  }
  
  return {
    attempts: this.emailVerificationAttempts || 0,
    maxAttempts: 10,
    remainingAttempts,
    isInCooldown,
    cooldownMinutes,
    canRequestVerification: !isInCooldown && remainingAttempts > 0
  };
};

// Generate password reset token
userSchema.methods.createPasswordResetToken = function () {
  const resetToken = crypto.randomBytes(32).toString("hex");

  this.passwordResetToken = crypto
    .createHash("sha256")
    .update(resetToken)
    .digest("hex");

  this.passwordResetExpires = Date.now() + 10 * 60 * 1000; // 10 minutes

  logger.debug(
    `Generated password reset token (raw): ${resetToken} for user ${this._id}`
  );

  return resetToken;
};

// ---------------- Export ---------------- //
const User = mongoose.model("User", userSchema);
export default User;
