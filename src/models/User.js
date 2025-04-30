// models/User.js
import mongoose from 'mongoose';
import validator from 'validator';
import bcrypt from 'bcryptjs';

// Address Schema
const addressSchema = new mongoose.Schema({
  street: { type: String, trim: true },
  city: { type: String, trim: true },
  state: { type: String, trim: true },
  postalCode: { type: String, trim: true },
  country: { type: String, trim: true }
});

// Availability Schema
const availabilitySchema = new mongoose.Schema({
  monday: { type: Boolean, default: true },
  tuesday: { type: Boolean, default: true },
  wednesday: { type: Boolean, default: true },
  thursday: { type: Boolean, default: true },
  friday: { type: Boolean, default: true },
  saturday: { type: Boolean, default: false },
  sunday: { type: Boolean, default: false }
});

// User Schema
const userSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: [true, 'First name is required'],
    trim: true
  },
  lastName: {
    type: String,
    required: [true, 'Last name is required'],
    trim: true
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    validate: [validator.isEmail, 'Please provide a valid email']
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: 8,
    select: false
  },
  passwordConfirm: {
    type: String,
    required: [true, 'Please confirm your password'],
    validate: {
      // Only works on CREATE and SAVE
      validator: function (el) {
        return el === this.password;
      },
      message: 'Passwords are not the same'
    }
  },
  role: {
    type: [String],
    enum: ['tasker', 'provider', 'admin'],
    required: [true, 'At least one role is required']
  },
  phoneNo: {
    type: String,
    validate: {
      validator: function (v) {
        return validator.isMobilePhone(v);
      },
      message: props => `${props.value} is not a valid phone number!`
    }
  },
  address: addressSchema,
  bio: {
    type: String,
    trim: true,
    maxlength: [500, 'Bio cannot be more than 500 characters']
  },
  profileImage: {
    type: String,
    default: 'default.jpg'
  },
  rating: {
    type: Number,
    default: 0,
    min: [0, 'Rating must be at least 0'],
    max: [5, 'Rating cannot be more than 5']
  },
  ratingCount: {
    type: Number,
    default: 0
  },
  hobbies: [{ type: String, trim: true }],
  peoplePreference: {
    type: String,
    trim: true,
    maxlength: [300, 'People preference cannot be more than 300 characters']
  },
  availability: {
    type: availabilitySchema,
    default: () => ({})
  },
  ratePerHour: {
    type: Number,
    default: 0
  },
  passwordChangedAt: Date,
  passwordResetToken: String,
  passwordResetExpires: Date,
  active: {
    type: Boolean,
    default: true,
    select: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  },

  // --- Stripe Connect ---
  stripeAccountId: {
    type: String,
    select: false
  },
  stripeOnboardingComplete: {
    type: Boolean,
    default: false,
    select: false
  }

}, {
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Add index for stripeAccountId
userSchema.index({ stripeAccountId: 1 });

// Virtual field for full name
userSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`;
});

// DOCUMENT MIDDLEWARE

// Hash the password before saving
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  this.passwordConfirm = undefined;
  next();
});

// Update passwordChangedAt when password is changed
userSchema.pre('save', function (next) {
  if (!this.isModified('password') || this.isNew) return next();
  this.passwordChangedAt = Date.now() - 1000; // Subtract 1s
  next();
});

// QUERY MIDDLEWARE

// Exclude inactive users from find queries
userSchema.pre(/^find/, function (next) {
  this.find({ active: { $ne: false } });
  next();
});

// INSTANCE METHODS

// Check if password is correct
userSchema.methods.correctPassword = async function (candidatePassword, userPassword) {
  return await bcrypt.compare(candidatePassword, userPassword);
};

// Check if password changed after token was issued
userSchema.methods.changedPasswordAfter = function (JWTTimestamp) {
  if (this.passwordChangedAt) {
    const changedTimestamp = parseInt(this.passwordChangedAt.getTime() / 1000, 10);
    return JWTTimestamp < changedTimestamp;
  }
  return false;
};

// Export User model
const User = mongoose.model('User', userSchema);
export default User;
