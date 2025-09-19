import mongoose from 'mongoose';
import validator from 'validator';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const userSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: [true, 'Please tell us your first name!']
  },
  lastName: {
    type: String,
    required: [true, 'Please tell us your last name!']
  },
  email: {
    type: String,
    required: [true, 'Please provide your email'],
    unique: true,
    lowercase: true,
    validate: [validator.isEmail, 'Please provide a valid email']
  },
  photo: {
    type: String,
    default: 'default.jpg'
  },
  role: {
    type: [String],
    enum: ['user', 'tasker', 'provider', 'admin'],
    default: ['user']
  },
  password: {
    type: String,
    required: [true, 'Please provide a password'],
    minlength: 8,
    select: false
  },
  passwordConfirm: {
    type: String,
    required: [true, 'Please confirm your password'],
    validate: {
      // This only works on CREATE and SAVE!!!
      validator: function(el) {
        return el === this.password;
      },
      message: 'Passwords are not the same!'
    }
  },
  passwordChangedAt: Date,
  passwordResetToken: String,
  passwordResetExpires: Date,
  active: {
    type: Boolean,
    default: true,
    select: false
  },
  address: {
    street: String,
    city: String,
    state: String,
    postalCode: String,
    country: String
  },
  phone: {
    type: String,
    validate: {
      validator: function(v) {
        return /\+?[1-9]\d{1,14}$/.test(v);
      },
      message: props => `${props.value} is not a valid phone number!`
    }
  },
  dateOfBirth: {
    type: Date,
    validate: {
      validator: function(date) {
        // Must be at least 18 years old
        const today = new Date();
        const birthDate = new Date(date);
        const age = today.getFullYear() - birthDate.getFullYear();
        const monthDiff = today.getMonth() - birthDate.getMonth();
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
          return age - 1 >= 18;
        }
        return age >= 18;
      },
      message: 'User must be at least 18 years old'
    }
  },
  bio: {
    type: String,
    maxlength: [500, 'Bio must be less than 500 characters']
  },
  skills: [{
    type: String
  }],
  hourlyRate: {
    type: Number,
    min: [0, 'Hourly rate must be positive']
  },
  availability: {
    type: String,
    enum: ['full-time', 'part-time', 'occasional', 'not-available'],
    default: 'not-available'
  },
  // --- Payment Gateway Fields ---
  // Generic provider account ID (replaces stripe-specific field)
  providerAccountId: {
    type: String,
    index: true,
  },
  
  // Payment gateway identifier (e.g., 'stripe', 'paypal', etc.)
  paymentGateway: {
    type: String,
    enum: ['stripe', 'paypal', 'manual'], // Extend as needed
  },
  
  // For backward compatibility with existing Stripe accounts
  stripeAccountId: {
    type: String,
    index: true,
    select: false
  },
  
  // Stripe-specific fields (kept for migration purposes)
  stripeCustomerId: String,
  stripeChargesEnabled: Boolean,
  stripePayoutsEnabled: Boolean,
  
  // Onboarding status flags
  isTaskerOnboardingComplete: {
    type: Boolean,
    default: false
  },
  isProviderOnboardingComplete: {
    type: Boolean,
    default: false
  },
  
  // Terms agreement
  agreedToTerms: {
    type: Boolean,
    default: false
  },
  agreedToTermsAt: Date
}, {
  timestamps: true
});

userSchema.pre('save', async function(next) {
  // Only run this function if password was actually modified
  if (!this.isModified('password')) return next();

  // Hash the password with cost of 12
  this.password = await bcrypt.hash(this.password, 12);

  // Delete passwordConfirm field
  this.passwordConfirm = undefined;
  next();
});

userSchema.pre('save', function(next) {
  if (!this.isModified('password') || this.isNew) return next();

  this.passwordChangedAt = Date.now() - 1000;
  next();
});

userSchema.pre(/^find/, function(next) {
  // this points to the current query
  this.find({ active: { $ne: false } });
  next();
});

userSchema.methods.correctPassword = async function(
  candidatePassword,
  userPassword
) {
  return await bcrypt.compare(candidatePassword, userPassword);
};

userSchema.methods.changedPasswordAfter = function(JWTTimestamp) {
  if (this.passwordChangedAt) {
    const changedTimestamp = parseInt(
      this.passwordChangedAt.getTime() / 1000,
      10
    );

    return JWTTimestamp < changedTimestamp;
  }

  // False means NOT changed
  return false;
};

userSchema.methods.createPasswordResetToken = function() {
  const resetToken = crypto.randomBytes(32).toString('hex');

  this.passwordResetToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');

  this.passwordResetExpires = Date.now() + 10 * 60 * 1000;

  return resetToken;
};

// Method to check if user has a payment account connected
userSchema.methods.hasPaymentAccount = function() {
  return !!this.providerAccountId;
};

// Method to get user's payment gateway
userSchema.methods.getPaymentGateway = function() {
  // Return the explicitly set payment gateway or default to stripe for backward compatibility
  return this.paymentGateway || (this.stripeAccountId ? 'stripe' : null);
};

const User = mongoose.model('User', userSchema);

export default User;