import mongoose from "mongoose";

// Define the Nuvei payment schema
const nuveiPaymentSchema = new mongoose.Schema(
  {
    // Contract related to the payment
    contract: {
      type: mongoose.Schema.ObjectId,
      ref: "Contract",
      required: function() { return this.type !== 'withdrawal'; },
    },

    // Gig related to the payment
    gig: {
      type: mongoose.Schema.ObjectId,
      ref: "Gig",
      required: function() { return this.type !== 'withdrawal'; },
    },

    // Payer: Provider making the payment
    payer: {
      type: mongoose.Schema.ObjectId,
      ref: "User",
      required: [true, "A payment must have a payer."],
      index: true,
    },

    // Payee: Tasker receiving the payment
    payee: {
      type: mongoose.Schema.ObjectId,
      ref: "User",
      required: [true, "A payment must have a payee."],
      index: true,
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
      default: 'Nuvei payment for services',
    },

    // Total payment amount (in cents)
    amount: {
      type: Number,
      required: [true, "Payment amount is required."],
    },

    // Currency used for the payment
    currency: {
      type: String,
      required: true,
      default: "cad", // Default to CAD for Nuvei
    },

    // Platform's application fee in cents
    applicationFeeAmount: {
      type: Number,
      required: true,
      default: 0,
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
      default: "pending",
      required: true,
      index: true,
      enum: ['pending', 'requires_payment_method', 'processing', 'succeeded', 'failed', 'refunded', 'cancelled']
    },

    // Payment method used (card, instadebit, etc.)
    paymentMethodType: {
      type: String,
      enum: ['card', 'instadebit', 'ach', 'bank_transfer'],
      required: true,
    },

    // --- Nuvei Specific Fields ---
    nuveiSessionId: {
      type: String,
      required: function() {
        // Only required for completed or processed statuses
        return ['succeeded', 'failed', 'processing', 'refunded', 'cancelled'].includes(this.status);
      },
      index: true,
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
      required: function() {
        // Only required for completed or processed statuses
        return ['succeeded', 'failed', 'processing', 'refunded', 'cancelled'].includes(this.status);
      },
    },
    nuveiMerchantSiteId: {
      type: String,
      required: function() {
        // Only required for completed or processed statuses
        return ['succeeded', 'failed', 'processing', 'refunded', 'cancelled'].includes(this.status);
      },
    },
    nuveiOrderId: {
      type: String,
      required: function() {
        // Only required for completed or processed statuses
        return ['succeeded', 'failed', 'processing', 'refunded', 'cancelled'].includes(this.status);
      },
    },
    nuveiPaymentMethod: {
      type: String,
      enum: ['card', 'instadebit', 'apm'],
    },
    nuveiApmProvider: {
      type: String, // For specific APM providers like instadebit
    },
    nuveiBankTransferId: {
      type: String, // For tracking bank transfer transactions
      sparse: true,
    },
    nuveiRefundId: {
      type: String,
      sparse: true,
    },

    // Payment attempt tracking
    paymentAttempts: {
      type: Number,
      default: 0,
    },

    // --- Timestamps ---
    succeededAt: { type: Date }, // Timestamp for when the payment was successful
    refundedAt: { type: Date }, // Timestamp for when the payment was refunded
    failedAt: { type: Date }, // Timestamp for when the payment failed

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
    
    // Flag to indicate if this payment was created using Nuvei Simply Connect
    isSimplyConnect: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true, // Automatically manage createdAt and updatedAt fields
  }
);

// Pre-save hook to calculate fees and update timestamps when the payment is saved
nuveiPaymentSchema.pre("save", async function (next) {
  // Handle withdrawals differently from regular payments
  if (this.type === 'withdrawal') {
    // For withdrawals, set the same values as the amount (no fees/taxes for withdrawals)
    this.amountReceivedByPayee = this.amount;
    this.amountAfterTax = this.amount;
    this.taxAmount = 0;
    this.applicationFeeAmount = 0;
    this.totalProviderPayment = this.amount;
  } else {
    // Calculate fees for regular payments
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
      
      console.log(`💰 Nuvei Payment Breakdown for ${this._id}:
        ✅ Tasker receives: $${(this.amountReceivedByPayee / 100).toFixed(2)} (full agreed amount)
        💼 Platform fee: $${(this.applicationFeeAmount / 100).toFixed(2)} (platform revenue)
        🏛️ Provider tax: $${(this.providerTaxAmount / 100).toFixed(2)}
        💳 Provider pays total: $${(this.totalProviderPayment / 100).toFixed(2)}`);
    }
  }
  
  // Update timestamps for payment status changes
  if (this.isModified("status")) {
    if (this.status === "succeeded" && !this.succeededAt) {
      this.succeededAt = Date.now();
    } else if (this.status === "refunded" && !this.refundedAt) {
      this.refundedAt = Date.now();
    } else if (this.status === "failed" && !this.failedAt) {
      this.failedAt = Date.now();
    }
  }
  next(); // Proceed to save the document
});

// Create and export the NuveiPayment model based on the schema
const NuveiPayment = mongoose.model("NuveiPayment", nuveiPaymentSchema);
export default NuveiPayment;