import mongoose from 'mongoose';

const paymentSchema = new mongoose.Schema({
  contract: {
    type: mongoose.Schema.ObjectId,
    ref: 'Contract',
    required: [true, 'Payment must be linked to a contract.'],
    unique: true
  },
  gig: {
    type: mongoose.Schema.ObjectId,
    ref: 'Gig',
    required: true
  },
  provider: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: true
  },
  tasker: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: true
  },
  amount: {
    type: Number,
    required: [true, 'Payment amount is required.'],
    min: [0, 'Amount cannot be negative.']
  },
  currency: {
    type: String,
    required: true,
    default: 'usd'
  },
  status: {
    type: String,
    enum: [
      'pending_funding',
      'escrow_funded',
      'payout_initiated',
      'payout_completed',
      'payout_failed',
      'refund_initiated',
      'refunded',
      'dispute_hold'
    ],
    required: true,
    default: 'pending_funding'
  },
  paymentMethodType: {
    type: String,
    required: true
  },
  stripePaymentIntentId: {
    type: String,
    index: true,
    sparse: true
  },
  stripeChargeId: {
    type: String,
    index: true,
    sparse: true
  },
  stripeTransferId: {
    type: String,
    index: true,
    sparse: true
  },
  stripeDestinationAccountId: {
    type: String
  },
  interacReference: {
    type: String
  },
  interacSenderEmail: {
    type: String
  },
  interacRecipientEmail: {
    type: String
  },
  escrowFundedAt: { type: Date },
  payoutInitiatedAt: { type: Date },
  payoutCompletedAt: { type: Date },
  refundedAt: { type: Date },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes
paymentSchema.index({ contract: 1 }, { unique: true });
paymentSchema.index({ provider: 1, status: 1 });
paymentSchema.index({ tasker: 1, status: 1 });

const Payment = mongoose.model('Payment', paymentSchema);

export default Payment;
