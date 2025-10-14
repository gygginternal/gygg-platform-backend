import mongoose from "mongoose";

// Define the payment schema
const paymentSchema = new mongoose.Schema(
  {
    // Contract related to the payment (optional for withdrawals)
    contract: {
      type: mongoose.Schema.ObjectId,
      ref: "Contract",
      required: function() { return this.type !== 'withdrawal'; },
      unique: true,
      sparse: true, // Allow null values for withdrawals
    },

    // Gig related to the payment (optional for withdrawals)
    gig: {
      type: mongoose.Schema.ObjectId,
      ref: "Gig",
      required: function() { return this.type !== 'withdrawal'; },
    },

    // Payer: Provider making the payment or user withdrawing
    payer: {
      type: mongoose.Schema.ObjectId,
      ref: "User",
      required: [true, "A payment must have a payer."],
      index: true, // Index to search quickly by payer
    },

    // Payee: Tasker receiving the payment or user receiving withdrawal
    payee: {
      type: mongoose.Schema.ObjectId,
      ref: "User",
      required: [true, "A payment must have a payee."],
      index: true, // Index to search quickly by payee
    },

    // Payment type: 'payment' (default) or 'withdrawal'
    type: {
      type: String,
      enum: ['payment', 'withdrawal'],
      default: 'payment',
      required: true,
    },

    // Description for the payment/withdrawal
    description: {
      type: String,
      default: 'Payment for services',
    },

    // Total payment amount (in cents)
    amount: {
      type: Number,
      required: [true, "Payment amount is required."],
    },

    // Currency used for the payment (defaults to 'USD')
    currency: {
      type: String,
      required: true,
      default: "usd",
    },

    // Platform's application fee in cents
    applicationFeeAmount: {
      type: Number,
      required: true,
      default: 0, // Default to 0 if not specified
    },

    // Amount actually received by the Tasker (after deducting the platform fee)
    amountReceivedByPayee: {
      type: Number,
      required: true,
    },

    // Total amount provider pays (service + platform fee + tax)
    totalProviderPayment: {
      type: Number,
      default: 0,
    },

    // Tax amount paid by provider
    providerTaxAmount: {
      type: Number,
      default: 0,
    },

    // Tax amount paid by tasker (deducted from their payment)
    taskerTaxAmount: {
      type: Number,
      default: 0,
    },

    // Status of the payment process
    status: {
      type: String,
      default: "pending_contract",
      required: true,
      index: true, // Index to search quickly by status
    },

    // Type of payment method used (Stripe, Credit Card, etc.)
    paymentMethodType: {
      type: String,
    },

    // --- Stripe Specific Fields ---
    stripePaymentIntentSecret: {
      type: String,
      index: true,
      unique: true,
      sparse: true, // This field might be missing in some payments, so it is sparse.
    },

    stripePayoutId: {
      type: String,
      index: true,
      unique: true,
      sparse: true, // This field might be missing in some payments, so it is sparse.
    },
    stripePaymentIntentId: {
      type: String,
      index: true,
      unique: true,
      sparse: true, // This field might be missing in some payments, so it is sparse.
    },

    stripeChargeId: {
      type: String,
      index: true,
    },

    stripeTransferId: {
      type: String,
      index: true,
      sparse: true, // This field might not exist for all payments
    },

    stripeRefundId: {
      type: String,
      index: true,
    },

    // Payment provider (Stripe or Nuvei)
    paymentProvider: {
      type: String,
      enum: ['stripe', 'nuvei'],
      default: 'stripe',
      required: true,
    },

    // Stripe fields (only required for Stripe payments)
    stripeConnectedAccountId: {
      type: String,
      required: function() { return this.paymentProvider === 'stripe'; },
    },
    stripePaymentIntentSecret: {
      type: String,
      index: true,
      unique: true,
      sparse: true, // This field might be missing in some payments, so it is sparse.
    },
    stripePayoutId: {
      type: String,
      index: true,
      unique: true,
      sparse: true, // This field might be missing in some payments, so it is sparse.
    },
    stripePaymentIntentId: {
      type: String,
      index: true,
      unique: true,
      sparse: true, // This field might be missing in some payments, so it is sparse.
    },
    stripeChargeId: {
      type: String,
      index: true,
    },
    stripeTransferId: {
      type: String,
      index: true,
      sparse: true, // This field might not exist for all payments
    },
    stripeRefundId: {
      type: String,
      index: true,
    },

    // Nuvei-specific fields (only required for Nuvei payments)
    nuveiSessionId: {
      type: String,
      index: true,
      sparse: true,
    },
    nuveiTransactionId: {
      type: String,
      index: true,
      sparse: true,
    },
    nuveiPaymentToken: {
      type: String,
      sparse: true,
    },
    nuveiMerchantId: {
      type: String,
      sparse: true,
    },
    nuveiMerchantSiteId: {
      type: String,
      sparse: true,
    },

    // --- Timestamps ---
    succeededAt: { type: Date }, // Timestamp for when the payment was successful
    refundedAt: { type: Date }, // Timestamp for when the payment was refunded

    // Tax amount (in cents)
    taxAmount: {
      type: Number,
      required: true,
      default: 0,
    },

    // Amount after tax (in cents)
    amountAfterTax: {
      type: Number,
      required: true,
      default: 0,
    },
  },
  {
    timestamps: true, // Automatically manage createdAt and updatedAt fields
  }
);

// Pre-save hook to calculate fees and update timestamps when the payment is saved
paymentSchema.pre("save", async function (next) {
  // Handle withdrawals differently from regular payments
  if (this.type === 'withdrawal') {
    // For withdrawals, set the same values as the amount (no fees/taxes for withdrawals)
    this.amountReceivedByPayee = this.amount;
    this.amountAfterTax = this.amount;
    this.taxAmount = 0;
    this.applicationFeeAmount = 0;
    this.totalProviderPayment = this.amount;
  } else {
    // CORRECT FEE STRUCTURE:
    // - Provider pays: Listed Amount + Platform Fee + Tax on total
    // - Tasker receives: Listed Amount (exactly what was agreed upon)
    // - Platform receives: Platform Fee (this is the platform's revenue)
    if ((this.isModified("amount") || this.isNew) && (this.taxAmount === 0 || this.taxAmount === undefined)) {
      // Use environment variables for fee/tax configuration
      const fixedFeeCents = parseInt(process.env.PLATFORM_FIXED_FEE_CENTS) || 500; // $5.00 in cents
      const feePercentage = parseFloat(process.env.PLATFORM_FEE_PERCENT) || 0.10; // 10%
      const taxPercent = parseFloat(process.env.TAX_PERCENT) || 0.13; // 13%
      
      // Service amount (this is what the tasker receives - the agreed upon amount)
      const agreedServiceAmount = this.amount;
      
      // Platform fee calculation (percentage of service amount + fixed fee)
      // This fee goes to the platform as revenue
      this.applicationFeeAmount = Math.round(agreedServiceAmount * feePercentage) + fixedFeeCents;
      
      // Provider pays tax on the total amount they pay (service + platform fee)
      const providerTaxableAmount = agreedServiceAmount + this.applicationFeeAmount;
      this.providerTaxAmount = Math.round(providerTaxableAmount * taxPercent);
      
      // Tasker receives the full agreed amount (no deductions)
      this.taskerTaxAmount = 0;
      
      // Total tax amount (only provider tax in this model)
      this.taxAmount = this.providerTaxAmount;
      
      // Total amount provider pays (service amount + platform fee + tax)
      this.totalProviderPayment = agreedServiceAmount + this.applicationFeeAmount + this.providerTaxAmount;
      
      // Amount tasker receives (the full agreed service amount - no fees deducted)
      this.amountReceivedByPayee = agreedServiceAmount;
      
      // Amount after tax (for legacy compatibility)
      this.amountAfterTax = agreedServiceAmount;
      
      console.log(`💰 Payment Breakdown for ${this._id}:
        ✅ Tasker receives: $${(this.amountReceivedByPayee / 100).toFixed(2)} (full agreed amount)
        💼 Platform fee: $${(this.applicationFeeAmount / 100).toFixed(2)} (platform revenue)
        🏛️ Provider tax: $${(this.providerTaxAmount / 100).toFixed(2)}
        💳 Provider pays total: $${(this.totalProviderPayment / 100).toFixed(2)}`);
    }
  }
  
  // Update timestamps for successful or refunded payment status
  if (this.isModified("status")) {
    if (this.status === "succeeded" && !this.succeededAt) {
      this.succeededAt = Date.now();
    } else if (this.status === "refunded" && !this.refundedAt) {
      this.refundedAt = Date.now();
    }
  }
  next(); // Proceed to save the document
});

// Create and export the Payment model based on the schema
const Payment = mongoose.model("Payment", paymentSchema);
export default Payment;
