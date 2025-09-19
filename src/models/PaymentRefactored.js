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

    // Amount actually received by the recipient (after deducting the platform fee)
    amountReceivedByPayee: {
      type: Number,
      required: true,
    },

    // Total amount payer pays (service + platform fee + tax)
    totalProviderPayment: {
      type: Number,
      default: 0,
    },

    // Tax amount paid by payer
    providerTaxAmount: {
      type: Number,
      default: 0,
    },

    // Tax amount paid by payee (deducted from their payment)
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

    // Type of payment method used (Stripe, PayPal, etc.)
    paymentMethodType: {
      type: String,
      required: true,
      enum: ['stripe', 'paypal', 'bank_transfer', 'other'], // Extend as needed
    },

    // Payment gateway identifier (e.g., 'stripe', 'paypal', etc.)
    paymentGateway: {
      type: String,
      required: true,
      enum: ['stripe', 'paypal', 'manual'], // Extend as needed
    },

    // Generic payment intent identifier (replaces stripe-specific field)
    paymentIntentId: {
      type: String,
      index: true,
      unique: true,
      sparse: true,
    },

    // Generic payout identifier (replaces stripe-specific field)
    payoutId: {
      type: String,
      index: true,
      unique: true,
      sparse: true,
    },

    // Generic refund identifier
    refundId: {
      type: String,
      index: true,
    },

    // Generic transfer identifier
    transferId: {
      type: String,
      index: true,
      sparse: true,
    },

    // Provider account ID (could be Stripe account ID, PayPal merchant ID, etc.)
    providerAccountId: {
      type: String,
      required: true,
      index: true,
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
    
    // Gateway-specific metadata (for storing provider-specific data)
    gatewayMetadata: {
      type: Map,
      of: String,
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