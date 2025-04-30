import mongoose from 'mongoose';

const contractSchema = new mongoose.Schema({
  gig: {
    type: mongoose.Schema.ObjectId,
    ref: 'Gig',
    required: [true, 'A contract must be associated with a gig.']
  },
  provider: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: [true, 'A contract must have a provider (gig poster).']
  },
  tasker: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: [true, 'A contract must have a tasker assigned.']
  },
  agreedCost: {
    type: Number,
    required: [true, 'A contract must have an agreed cost.'],
    min: [0, 'Agreed cost cannot be negative.']
  },
  status: {
    type: String,
    enum: [
      'pending_acceptance',
      'pending_payment',
      'active',
      'submitted',
      'disputed',
      'revision_requested',
      'approved',
      'completed',
      'cancelled_by_provider',
      'cancelled_by_tasker',
      'cancelled_mutual'
    ],
    default: 'pending_acceptance',
    required: true
  },
  terms: {
    type: String,
    trim: true
  },
  taskerAcceptedAt: {
    type: Date
  },
  workSubmittedAt: {
    type: Date
  },
  providerApprovedAt: {
    type: Date
  },
  cancelledAt: {
    type: Date
  },
  cancellationReason: {
    type: String,
    trim: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' }
});

// Indexes for performance
contractSchema.index({ gig: 1 });
contractSchema.index({ provider: 1, status: 1 });
contractSchema.index({ tasker: 1, status: 1 });

// Auto-populate references
contractSchema.pre(/^find/, function(next) {
  this.populate({
    path: 'provider',
    select: 'firstName lastName profileImage'
  }).populate({
    path: 'tasker',
    select: 'firstName lastName profileImage'
  }).populate({
    path: 'gig',
    select: 'title status'
  });
  next();
});

const Contract = mongoose.model('Contract', contractSchema);

export default Contract;
