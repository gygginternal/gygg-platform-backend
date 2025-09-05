import mongoose from "mongoose";

// Time Entry Schema for tracking hours on hourly gigs
const timeEntrySchema = new mongoose.Schema(
  {
    // Contract this time entry belongs to
    contract: {
      type: mongoose.Schema.ObjectId,
      ref: "Contract",
      required: [true, "Time entry must belong to a contract"],
      index: true,
    },

    // Gig this time entry is for
    gig: {
      type: mongoose.Schema.ObjectId,
      ref: "Gig",
      required: [true, "Time entry must belong to a gig"],
      index: true,
    },

    // Tasker who worked the hours
    tasker: {
      type: mongoose.Schema.ObjectId,
      ref: "User",
      required: [true, "Time entry must have a tasker"],
      index: true,
    },

    // Provider who will approve the hours
    provider: {
      type: mongoose.Schema.ObjectId,
      ref: "User",
      required: [true, "Time entry must have a provider"],
      index: true,
    },

    // Start time of work session
    startTime: {
      type: Date,
      required: [true, "Start time is required"],
    },

    // End time of work session (null if currently active)
    endTime: {
      type: Date,
      validate: {
        validator: function(endTime) {
          return !endTime || endTime > this.startTime;
        },
        message: "End time must be after start time",
      },
    },

    // Calculated hours worked (auto-calculated)
    hoursWorked: {
      type: Number,
      min: [0, "Hours worked cannot be negative"],
      get: function() {
        if (this.startTime && this.endTime) {
          return Math.round(((this.endTime - this.startTime) / (1000 * 60 * 60)) * 100) / 100;
        }
        return 0;
      },
    },

    // Description of work done during this session
    description: {
      type: String,
      trim: true,
      maxlength: [500, "Description cannot exceed 500 characters"],
    },

    // Status of this time entry
    status: {
      type: String,
      enum: ["active", "submitted", "approved", "rejected"],
      default: "active",
      required: true,
    },

    // Provider's approval/rejection notes
    providerNotes: {
      type: String,
      trim: true,
      maxlength: [500, "Provider notes cannot exceed 500 characters"],
    },

    // Date when provider approved/rejected
    reviewedAt: {
      type: Date,
    },

    // Hourly rate at time of work (for historical accuracy)
    hourlyRate: {
      type: Number,
      required: [true, "Hourly rate is required"],
      min: [0, "Hourly rate cannot be negative"],
    },

    // Calculated payment for this session (hoursWorked * hourlyRate)
    sessionPayment: {
      type: Number,
      min: [0, "Session payment cannot be negative"],
      get: function() {
        return Math.round(this.hoursWorked * this.hourlyRate * 100) / 100;
      },
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, getters: true },
    toObject: { virtuals: true, getters: true },
  }
);

// Indexes for performance
timeEntrySchema.index({ contract: 1, status: 1 });
timeEntrySchema.index({ tasker: 1, status: 1 });
timeEntrySchema.index({ provider: 1, status: 1 });
timeEntrySchema.index({ gig: 1, status: 1 });
timeEntrySchema.index({ startTime: 1 });

// Prevent multiple active sessions for same tasker/contract
timeEntrySchema.index(
  { tasker: 1, contract: 1, status: 1 },
  { 
    unique: true,
    partialFilterExpression: { status: "active" }
  }
);

// Virtual for checking if session is currently active
timeEntrySchema.virtual('isActive').get(function() {
  return this.status === 'active' && !this.endTime;
});

// Pre-save middleware to calculate hours and payment
timeEntrySchema.pre('save', function(next) {
  if (this.startTime && this.endTime) {
    // Calculate hours worked
    const hours = (this.endTime - this.startTime) / (1000 * 60 * 60);
    this.hoursWorked = Math.round(hours * 100) / 100;
    
    // Calculate session payment
    if (this.hourlyRate) {
      this.sessionPayment = Math.round(this.hoursWorked * this.hourlyRate * 100) / 100;
    }
  }
  next();
});

// Static method to get total hours for a contract
timeEntrySchema.statics.getTotalHoursForContract = async function(contractId, status = 'approved') {
  const result = await this.aggregate([
    { $match: { contract: mongoose.Types.ObjectId(contractId), status } },
    { $group: { _id: null, totalHours: { $sum: '$hoursWorked' } } }
  ]);
  return result[0]?.totalHours || 0;
};

// Static method to get total payment for a contract
timeEntrySchema.statics.getTotalPaymentForContract = async function(contractId, status = 'approved') {
  const result = await this.aggregate([
    { $match: { contract: mongoose.Types.ObjectId(contractId), status } },
    { $group: { _id: null, totalPayment: { $sum: '$sessionPayment' } } }
  ]);
  return result[0]?.totalPayment || 0;
};

const TimeEntry = mongoose.model("TimeEntry", timeEntrySchema);
export default TimeEntry;