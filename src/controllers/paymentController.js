import Stripe from "stripe";
import Payment from "../models/Payment.js";
import Contract from "../models/Contract.js";
import User from "../models/User.js";
import AppError from "../utils/AppError.js";
import catchAsync from "../utils/catchAsync.js";
import mongoose from "mongoose";
import Notification from '../models/Notification.js';
import { Offer } from '../models/Offer.js';
import logger from '../utils/logger.js';
import notifyAdmin from '../utils/notifyAdmin.js';
import PDFDocument from 'pdfkit';
import { Readable } from 'stream';
import { generateInvoicePdf } from '../utils/invoicePdf.js';

// Initialize Stripe with the secret key from environment variables
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-06-30.basil' });

export const getPayments = catchAsync(async (req, res, next) => {
  const { status, payer, payee, page = 1, limit = 10 } = req.query;
  const currentUserId = req.user.id;
  console.log({ limit, page, currentUserId });

  // Build the query object
  const query = {};

  // Apply status filter if provided, otherwise default to succeeded
  if (status && status !== 'all') {
    query.status = status;
  } else {
    query.status = "succeeded"; // Default filter by payment status
  }

  // Security: Ensure users can only see their own payments
  // If specific payer/payee is requested, validate user has access
  if (payer && payee) {
    // Both specified - user must be either payer or payee
    if (payer !== currentUserId && payee !== currentUserId) {
      return next(new AppError("You can only view your own payments.", 403));
    }
    query.payer = payer;
    query.payee = payee;
  } else if (payer) {
    // Only payer specified - user must be the payer
    if (payer !== currentUserId) {
      return next(new AppError("You can only view payments where you are the payer.", 403));
    }
    query.payer = payer;
  } else if (payee) {
    // Only payee specified - user must be the payee
    if (payee !== currentUserId) {
      return next(new AppError("You can only view payments where you are the payee.", 403));
    }
    query.payee = payee;
  } else {
    // No specific payer/payee - show all payments where user is involved
    query.$or = [
      { payer: currentUserId },
      { payee: currentUserId }
    ];
  }

  // Pagination parameters
  const pageNumber = parseInt(page, 10) || 1; // Default to page 1
  const pageLimit = parseInt(limit, 10) || 10; // Default to 10 results per page
  const skip = (pageNumber - 1) * pageLimit;

  // Fetch payments based on the query with pagination
  const payments = await Payment.find(query)
    .populate("contract", "title") // Populate contract details
    .populate("payer", "firstName lastName email") // Populate payer details
    .populate("payee", "firstName lastName email") // Populate payee details
    .skip(skip)
    .limit(pageLimit);

  // Get the total count of payments for the query
  const totalPayments = await Payment.countDocuments(query);

  res.status(200).json({
    status: "success",
    results: payments.length,
    total: totalPayments,
    currentPage: pageNumber,
    totalPages: Math.ceil(totalPayments / pageLimit),
    data: {
      payments,
    },
  });
});

export const checkIfContractIsReleasable = catchAsync(
  async (req, res, next) => {
    const { contractId } = req.params;

    // Retrieve the payment record from the database
    const payment = await Payment.findOne({ contract: contractId }).populate(
      "payee"
    );

    if (!payment) {
      return next(new AppError("Payment not found for this contract.", 404));
    }

    // Check if the payment status is valid for release
    const isPayoutReady = payment.status === "succeeded";

    // Retrieve the available balance from Stripe
    const balance = await stripe.balance.retrieve({
      stripeAccount: payment.payee.stripeAccountId,
    });

    const available = balance.available.find(
      (b) => b.currency === payment.currency
    );
    const payoutAvailable = available ? available.amount : 0;

    // Check if the available balance is sufficient
    const isBalanceSufficient =
      payoutAvailable >= payment.amountReceivedByPayee;

    // Determine if the contract is releasable
    const isReleasable = isPayoutReady && isBalanceSufficient;

    res.status(200).json({
      status: "success",
      data: {
        isReleasable,
        isPayoutReady,
        isBalanceSufficient,
        payoutAvailable: (payoutAvailable / 100).toFixed(2),
        requiredAmount: (payment.amountReceivedByPayee / 100).toFixed(2),
        currency: payment.currency.toUpperCase(),
      },
    });
  }
);

export const createStripeLoginLink = catchAsync(async (req, res, next) => {
  const tasker = req.user;

  // Ensure the tasker has a Stripe account ID
  if (!tasker.stripeAccountId) {
    return next(
      new AppError("You do not have a connected Stripe account.", 400)
    );
  }

  // Generate a login link for the tasker's Stripe Express account
  const loginLink = await stripe.accounts.createLoginLink(
    tasker.stripeAccountId
  );

  if (!loginLink || !loginLink.url) {
    return next(new AppError("Failed to generate Stripe login link.", 500));
  }

  res.status(200).json({
    status: "success",
    data: {
      loginLink: loginLink.url,
    },
  });
});

export const getPaymentIntentForContract = catchAsync(
  async (req, res, next) => {
    const { contractId } = req.params;

    // Retrieve the payment intent from the database or payment provider (e.g., Stripe)
    const payment = await Payment.findOne({ contract: contractId });
    console.log({ payment });

    if (!payment) {
      return next(new AppError("Payment not found for this contract.", 404));
    }

    let paymentIntent;
    if (payment.stripePaymentIntentId) {
      paymentIntent = await stripe.paymentIntents.retrieve(
        payment.stripePaymentIntentId
      );
    }

    if (!paymentIntent) {
      return next(
        new AppError("Payment intent not found for this contract.", 404)
      );
    }

    res.status(200).json({
      status: "success",
      data: {
        paymentIntent,
        payment,
      },
    });
  }
);

export const releasePaymentForContract = catchAsync(async (req, res, next) => {
  const { contractId } = req.params;
  const providerId = req.user.id;

  // Validate contract ID
  if (!mongoose.Types.ObjectId.isValid(contractId))
    return next(new AppError("Invalid Contract ID format.", 400));

  // Find the contract and payment
  const contract = await Contract.findById(contractId);
  if (!contract) return next(new AppError("Contract not found.", 404));

  // Verify the provider is authorized to release the payment
  if (contract.provider._id.toString() !== providerId)
    return next(new AppError("Not authorized to release this payment.", 403));

  // Find the payment record
  const payment = await Payment.findOne({ contract: contractId });
  if (!payment) return next(new AppError("Payment not found.", 404));

  // Verify the payment is in a state that can be released
  if (payment.status !== "requires_capture")
    return next(
      new AppError(
        `Payment cannot be released in current status: ${payment.status}`,
        400
      )
    );

  try {
    // Capture the payment intent
    const paymentIntent = await stripe.paymentIntents.capture(
      payment.stripePaymentIntentId
    );

    // Update payment status
    payment.status = "succeeded";
    payment.succeededAt = new Date();
    await payment.save();

    // Update contract status if needed
    if (contract.status === "active") {
      contract.status = "completed";
      await contract.save();
    }

    // Update contract with payment breakdown
    contract.taxAmount = payment.taxAmount;
    contract.platformFeeAmount = payment.applicationFeeAmount;
    contract.payoutToTasker = payment.amountReceivedByPayee;
    await contract.save();

    res.status(200).json({
      status: "success",
      message: "Payment released successfully",
      paymentIntent,
    });
  } catch (error) {
    console.error("Error releasing payment:", error);
    return next(
      new AppError(
        `Failed to release payment: ${error.message}`,
        error.statusCode || 500
      )
    );
  }
});

// --- Create Payment Intent for Contract (Provider -> Tasker via Platform) ---
export const createPaymentIntentForContract = catchAsync(
  async (req, res, next) => {
    const { contractId } = req.params;
    const providerId = req.user.id;

    // Check if the contractId is valid
    if (!mongoose.Types.ObjectId.isValid(contractId))
      return next(new AppError("Invalid Contract ID format.", 400));

    // Fetch the contract along with the tasker details
    const contract = await Contract.findById(contractId);

    if (!contract) return next(new AppError("Contract not found.", 404));

    // Check if the provider is authorized to make the payment
    if (contract.provider._id.toString() !== providerId)
      return next(
        new AppError("Not authorized to pay for this contract.", 403)
      );

    // Ensure that the contract is in a valid status for payment
    if (!["active", "submitted", "failed"].includes(contract.status)) {
      return next(
        new AppError(
          `Contract not awaiting payment (status: ${contract.status}).`,
          400
        )
      );
    }

    // Ensure that the tasker has connected a valid Stripe account
    if (!contract.tasker?.stripeAccountId)
      return next(new AppError("Tasker has not connected Stripe.", 400));

    const taskerStripeAccountId = contract.tasker.stripeAccountId;
    
    // Validate that the Stripe account actually exists
    try {
      await stripe.accounts.retrieve(taskerStripeAccountId);
    } catch (error) {
      if (error.code === 'account_invalid' || error.type === 'StripePermissionError') {
        // Clear the invalid account ID from the user
        await User.findByIdAndUpdate(contract.tasker._id, { 
          $unset: { stripeAccountId: 1, stripeChargesEnabled: 1, stripePayoutsEnabled: 1 } 
        });
        return next(new AppError("Tasker's Stripe account is invalid. Please reconnect Stripe account.", 400));
      }
      throw error; // Re-throw other errors
    }
    // Create payment record first to calculate correct amounts
    const serviceAmountInCents = Math.round(contract.agreedCost * 100); // Base service amount
    if (serviceAmountInCents <= 0)
      return next(new AppError("Invalid contract cost.", 400));

    // --- Stripe Tax Integration ---
    // 1. Ensure provider has a Stripe customer with address info
    let provider = await User.findById(providerId);
    if (!provider) return next(new AppError("Provider not found.", 404));
    let stripeCustomerId = provider.stripeCustomerId;
    if (!stripeCustomerId) {
      // Create a Stripe customer for the provider if not exists
      const customer = await stripe.customers.create({
        email: provider.email,
        name: `${provider.firstName} ${provider.lastName}`,
        address: provider.address ? {
          line1: provider.address.street,
          city: provider.address.city,
          state: provider.address.state,
          postal_code: provider.address.postalCode,
          country: provider.address.country,
        } : undefined,
      });
      stripeCustomerId = customer.id;
      provider.stripeCustomerId = customer.id;
      await provider.save();
    }

    // 2. Remove manual tax calculation (Stripe Tax will handle it)
    // const taxPercent = parseFloat(process.env.TAX_PERCENT) || 0.13;
    // const taxAmount = Math.round(amountInCents * taxPercent);
    // const amountAfterTax = amountInCents - taxAmount;

    // 3. Create/update payment record (this will trigger the pre-save hook to calculate amounts)
    let payment = await Payment.findOne({ contract: contractId });
    if (!payment) {
      payment = await Payment.create({
        contract: contractId,
        gig: contract.gig,
        payer: providerId,
        payee: contract.tasker._id,
        amount: serviceAmountInCents, // Base service amount
        currency: 'cad',
        status: "requires_payment_method",
        stripeConnectedAccountId: taskerStripeAccountId,
      });
    } else if (!["requires_payment_method", "failed"].includes(payment.status)) {
      return next(new AppError(`Payment already in status: ${payment.status}`, 400));
    } else {
      payment.amount = serviceAmountInCents;
      payment.status = "requires_payment_method";
      await payment.save();
    }

    // Get the total amount provider needs to pay (after pre-save hook calculations)
    const totalProviderPaymentAmount = payment.totalProviderPayment || payment.amount;

    // 5. Create PaymentIntent with minimal required parameters
    const paymentIntentParams = {
      amount: totalProviderPaymentAmount,
      currency: payment.currency,
      // capture_method: "manual", // Disabled for testing - using automatic capture
      customer: stripeCustomerId,
      payment_method_types: ['card'], // Explicitly specify payment methods instead of automatic
      // Stripe Connect parameters - disabled until Connect is properly configured
      // application_fee_amount: payment.applicationFeeAmount,
      // transfer_data: { destination: taskerStripeAccountId },
      // automatic_payment_methods: { enabled: true }, // Disabled - not supported in current API version
      automatic_tax: { enabled: true }, // Enable Stripe automatic tax calculation
      metadata: {
        paymentId: payment._id.toString(),
        contractId: contractId.toString(),
        providerId: providerId.toString(),
        taskerId: contract.tasker._id.toString(),
      },
    };

    // For development/testing, always create a new PaymentIntent to avoid conflicts
    // In production, you might want to reuse PaymentIntents for better UX
    const paymentIntent = await stripe.paymentIntents.create(paymentIntentParams);
    payment.stripePaymentIntentId = paymentIntent.id;
    payment.stripePaymentIntentSecret = paymentIntent.client_secret;

    payment.status = "requires_payment_method";
    await payment.save();

    // Contract breakdown will be updated after payment confirmation (webhook)

    res.status(200).json({
      status: "success",
      clientSecret: paymentIntent.client_secret,
      paymentId: payment._id,
    });
  }
);

const handlePayoutPaid = async (dataObject) => {
  try {
    // Retrieve the payout ID from the event data
    const payoutId = dataObject.id;

    // Find the payment record associated with this payout
    const payment = await Payment.findOne({ stripePayoutId: payoutId });

    if (!payment) {
      console.error(`❌ Payment record not found for payout ID: ${payoutId}`);
      return;
    }

    // Update the payment status to "succeeded"
    payment.status = "succeeded";
    await payment.save();

    console.log(
      `✅ Payment status updated to "succeeded" for payout ID: ${payoutId}`
    );
  } catch (error) {
    console.error(`❌ Error handling payout.paid event: ${error.message}`);
  }
};

const handleChargeRefunded = async (dataObject) => {
  try {
    const charge = dataObject;

    // Retrieve the PaymentIntent ID from the charge
    const paymentIntentId = charge.payment_intent;

    if (!paymentIntentId) {
      console.log("No PaymentIntent associated with this charge.");
      return;
    }

    console.log(
      `Refunded charge was linked to PaymentIntent: ${paymentIntentId}`
    );

    // Fetch the PaymentIntent from Stripe
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    console.log(`PaymentIntent status: ${paymentIntent.status}`);

    // Find the payment record in the database
    const payment = await Payment.findOne({
      stripePaymentIntentId: paymentIntentId,
    });

    if (!payment) {
      console.error(
        `❌ Payment record not found for PaymentIntent: ${paymentIntentId}`
      );
      return;
    }

    // Update the payment status to "refunded"
    payment.status = "refunded";
    await payment.save();

    console.log(
      `✅ Payment status updated to "refunded" for PaymentIntent: ${paymentIntentId}`
    );

    // Find the associated contract and gig
    const contract = await Contract.findById(payment.contract);
    const gig = await Gig.findById(payment.gig);

    if (contract) {
      // Update the contract status to "cancelled"
      contract.status = "cancelled";
      await contract.save();
      console.log(
        `✅ Contract status updated to "cancelled" for Contract ID: ${contract._id}`
      );
    }

    if (gig) {
      // Update the gig status to "cancelled"
      gig.status = "cancelled";
      await gig.save();
      console.log(
        `✅ Gig status updated to "cancelled" for Gig ID: ${gig._id}`
      );
    }
  } catch (error) {
    console.error(`❌ Error handling charge.refunded event: ${error.message}`);
  }
};

// --- Stripe Webhook Handler ---
export const stripeWebhookHandler = async (req, res) => {
  const sig = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    console.log("receiving webhook event", JSON.stringify(event, null, 2));
  } catch (err) {
    console.error(`❌ Webhook signature verification failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const dataObject = event.data.object;

  switch (event.type) {
    case "payment_intent.succeeded":
      await handlePaymentIntentSucceeded(dataObject);
      break;
    case "payment_intent.canceled":
      await handlePaymentIntentCanceled(dataObject);
      break;
    case "charge.refunded":
      await handleChargeRefunded(dataObject);
      break;
    case "payout.paid":
      await handlePayoutPaid(dataObject);
      break;
    default:
      break;
  }

  res.status(200).json({ received: true });
};

// Endpoint to confirm payment success from frontend
export const confirmPaymentSuccess = catchAsync(async (req, res, next) => {
  const { paymentIntentId } = req.body;
  
  if (!paymentIntentId) {
    return next(new AppError('Payment Intent ID is required', 400));
  }

  try {
    // Verify the payment intent with Stripe
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    
    if (paymentIntent.status !== 'succeeded') {
      return next(new AppError('Payment has not succeeded yet', 400));
    }

    // Find the payment record
    const payment = await Payment.findOne({
      stripePaymentIntentId: paymentIntentId,
    }).populate('contract');

    if (!payment) {
      return next(new AppError('Payment record not found', 404));
    }

    // Update payment status and details
    payment.status = "succeeded";
    payment.succeededAt = new Date();
    
    // Calculate amounts from payment model
    let taxAmount = payment.taxAmount || 0;
    let amountAfterTax = payment.amountAfterTax || (paymentIntent.amount - taxAmount);
    let amountReceivedByPayee = payment.amountReceivedByPayee || 0;
    
    if (payment.applicationFeeAmount != null) {
      amountReceivedByPayee = amountAfterTax - payment.applicationFeeAmount;
    }

    payment.taxAmount = taxAmount;
    payment.amountAfterTax = amountAfterTax;
    payment.amountReceivedByPayee = amountReceivedByPayee;
    await payment.save();

    // Update contract status
    const contract = await Contract.findById(payment.contract);
    if (contract && contract.status !== "completed") {
      contract.status = "completed";
      await contract.save();
    }

    res.status(200).json({
      status: "success",
      message: "Payment confirmed and contract updated",
      data: {
        payment: {
          id: payment._id,
          status: payment.status,
          amount: payment.amount,
          taxAmount: payment.taxAmount,
          amountAfterTax: payment.amountAfterTax,
          amountReceivedByPayee: payment.amountReceivedByPayee,
        },
        contract: {
          id: contract._id,
          status: contract.status,
        }
      }
    });
  } catch (error) {
    console.error('Error confirming payment success:', error);
    return next(new AppError('Failed to confirm payment success', 500));
  }
});

// Add new handler for payment_intent.succeeded
const handlePaymentIntentSucceeded = async (paymentIntent) => {
  try {
    const payment = await Payment.findOne({
      stripePaymentIntentId: paymentIntent.id,
    });

    if (!payment) {
      console.error(`❌ Payment not found for PaymentIntent: ${paymentIntent.id}`);
      return;
    }

    // Extract tax and payout info from payment model (manual calculation)
    // Automatic tax is disabled - using manual tax calculation from environment
    let taxAmount = payment.taxAmount || 0;
    let amountAfterTax = payment.amountAfterTax || (paymentIntent.amount - taxAmount);
    let amountReceivedByPayee = payment.amountReceivedByPayee || 0;
    // amountReceivedByPayee = amountAfterTax - applicationFeeAmount
    if (payment.applicationFeeAmount != null) {
      amountReceivedByPayee = amountAfterTax - payment.applicationFeeAmount;
    }

    // Update payment status and Stripe-calculated fields
    payment.status = "succeeded";
    payment.succeededAt = new Date();
    payment.taxAmount = taxAmount;
    payment.amountAfterTax = amountAfterTax;
    payment.amountReceivedByPayee = amountReceivedByPayee;
    await payment.save();

    // Update contract status
    const contract = await Contract.findById(payment.contract);
    if (contract) {
      contract.status = "completed";
      await contract.save();
    }

    console.log(`✅ Payment succeeded for PaymentIntent: ${paymentIntent.id}`);
  } catch (error) {
    console.error(`❌ Error handling payment_intent.succeeded: ${error.message}`);
  }
};

// Add new handler for payment_intent.canceled
const handlePaymentIntentCanceled = async (paymentIntent) => {
  try {
    const payment = await Payment.findOne({
      stripePaymentIntentId: paymentIntent.id,
    });

    if (!payment) {
      console.error(`❌ Payment not found for PaymentIntent: ${paymentIntent.id}`);
      return;
    }

    // Update payment status
    payment.status = "canceled";
    await payment.save();

    // Update contract status
    const contract = await Contract.findById(payment.contract);
    if (contract) {
      contract.status = "cancelled";
      await contract.save();
    }

    console.log(`✅ Payment canceled for PaymentIntent: ${paymentIntent.id}`);
  } catch (error) {
    console.error(`❌ Error handling payment_intent.canceled: ${error.message}`);
  }
};

// --- Initiate Refund for Contract ---
export const refundPaymentForContract = catchAsync(async (req, res, next) => {
  const { contractId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(contractId))
    return next(new AppError("Invalid Contract ID format.", 400));

  const contract = await Contract.findById(contractId);
  if (!contract) return next(new AppError("Contract not found", 404));

  const payment = await Payment.findOne({ contract: contractId });
  if (!payment) return next(new AppError("Payment record not found", 404));
  // if (payment.status !== "succeeded")
  //   return next(
  //     new AppError(`Cannot refund payment with status: ${payment.status}`, 400)
  //   );
  if (!payment.stripePaymentIntentId)
    return next(new AppError("Cannot refund: Missing Payment Intent ID.", 500));

  const paymentIntent = await stripe.paymentIntents.retrieve(
    payment.stripePaymentIntentId,
    {
      expand: ["charges"],
    }
  );

  const chargeId = paymentIntent.latest_charge;
  try {
    // Initiate the refund via Stripe
    const refund = await stripe.refunds.create({
      charge: chargeId,
    });
    console.log(
      `Stripe Refund created: ${refund.id}, Status: ${refund.status}`
    );

    // Update payment and contract status

    payment.status = refund.status === "succeeded" ? "canceled" : "canceling";
    payment.stripeRefundId = refund.id;
    await payment.save();
    contract.status = "cancelled";
    await contract.save();

    res.status(200).json({
      status: "success",
      message: "Refund initiated successfully.",
      refundId: refund.id,
    });
  } catch (error) {
    console.error(
      `❌ Error creating Stripe Refund for Charge ${payment.stripeChargeId}:`,
      error
    );
    return next(
      new AppError(`Failed to initiate refund: ${error.message}.`, 500)
    );
  }
});

// --- Create Stripe Account for User ---
export const createStripeAccount = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user.id);
  if (!user) return next(new AppError("User not found.", 404));

  // If user already has a Stripe account, proceed to create the account link
  if (user.stripeAccountId) {
    return createStripeAccountLink(req, res, next);
  }

  try {
    // Create a new Stripe Express account
    const account = await stripe.accounts.create({
      type: "express",
      country: "CA",
      email: user.email,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      business_type: "individual",
      settings: {
        payouts: {
          schedule: {
            interval: "manual", // Platform will trigger payouts manually
          },
        },
      },
    });

    user.stripeAccountId = account.id;
    await user.save({ validateBeforeSave: false });
    return createStripeAccountLink(req, res, next);
  } catch (error) {
    console.error("Error creating Stripe account:", error);
    return next(new AppError("Could not create Stripe account.", 500));
  }
});

// --- Generate Stripe Account Onboarding Link ---
export const createStripeAccountLink = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user.id).select("+stripeAccountId");

  if (!user || !user.stripeAccountId) {
    const account = await stripe.accounts.create({
      type: "express",
      country: "CA",
      email: user.email,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      business_type: "individual",
      settings: {
        payouts: {
          schedule: {
            interval: "manual", // Platform will trigger payouts manually
          },
        },
      },
    });

    user.stripeAccountId = account.id;
    await user.save();
  }

  try {
    // Create the Stripe account link for onboarding
    const accountLink = await stripe.accountLinks.create({
      account: user.stripeAccountId,
      refresh_url: `${process.env.FRONTEND_URL}/stripe-onboarding/refresh`,
      return_url: `${process.env.FRONTEND_URL}/stripe-onboarding/return`,
      type: "account_onboarding",
    });

    res.status(200).json({ status: "success", url: accountLink.url });
  } catch (error) {
    console.error(
      `Error creating Account Link for ${user.stripeAccountId}:`,
      error
    );
    return next(new AppError("Could not create onboarding link.", 500));
  }
});

// --- Get Stripe Account Status ---
export const getStripeAccountStatus = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user.id).select("+stripeAccountId");
  if (!user || !user.stripeAccountId) {
    // Return a response indicating no Stripe account exists
    return res.status(200).json({
      status: "success",
      account: null,
      payoutsEnabled: false,
      detailsSubmitted: false,
      chargesEnabled: false,
      stripeAccountStatus: "not_connected",
      message: "No Stripe account connected"
    });
  }

  try {
    const account = await stripe.accounts.retrieve(user.stripeAccountId);
    res.status(200).json({
      account,
      status: "success",
      payoutsEnabled: account.payouts_enabled,
      detailsSubmitted: account.details_submitted,
      chargesEnabled: account.capabilities.card_payments === "active",
      stripeAccountStatus:
        account.capabilities.transfers === "active" ? "active" : "incomplete",
    });
  } catch (error) {
    console.error(
      `Error retrieving Stripe account ${user.stripeAccountId}:`,
      error
    );
    
    // Handle specific Stripe errors
    if (error.type === 'StripePermissionError' && error.code === 'account_invalid') {
      // The account doesn't exist or is invalid, clear it from the user
      user.stripeAccountId = undefined;
      await user.save({ validateBeforeSave: false });
      
      return res.status(200).json({
        status: "success",
        account: null,
        payoutsEnabled: false,
        detailsSubmitted: false,
        chargesEnabled: false,
        stripeAccountStatus: "not_connected",
        message: "Previous Stripe account was invalid and has been cleared"
      });
    }
    
    return next(new AppError("Could not retrieve account status.", 500));
  }
});

export const deletePayment = catchAsync(async (req, res, next) => {
  const paymentId = req.params.id;
  const payment = await Payment.findById(paymentId);
  if (!payment) return next(new AppError('No payment found with that ID', 404));
  // Only payer, payee, or admin can delete
  if (![payment.payer.toString(), payment.payee.toString()].includes(req.user.id) && !req.user.role.includes('admin')) {
    return next(new AppError('You do not have permission to delete this payment.', 403));
  }
  // Cascade delete related records
  await Promise.all([
    Notification.deleteMany({ 'data.paymentId': paymentId }),
    Offer.deleteMany({ payment: paymentId }),
  ]);
  await Payment.findByIdAndDelete(paymentId);
  logger.warn(`Payment ${paymentId} and related data deleted by user ${req.user.id}`);
  await notifyAdmin('Payment deleted', { paymentId, deletedBy: req.user.id });
  res.status(204).json({ status: 'success', data: null });
});

// --- Generate PDF Invoice for Payment ---
export const getInvoicePdf = catchAsync(async (req, res, next) => {
  const { paymentId } = req.params;
  const payment = await Payment.findById(paymentId)
    .populate('payer', 'firstName lastName email')
    .populate('payee', 'firstName lastName email')
    .populate('contract')
    .populate('gig', 'title');
  if (!payment) return res.status(404).json({ status: 'fail', message: 'Payment not found' });

  // Only payer, payee, or admin can access
  if (![payment.payer._id.toString(), payment.payee._id.toString()].includes(req.user.id) && !req.user.role.includes('admin')) {
    return res.status(403).json({ status: 'fail', message: 'You do not have permission to view this invoice.' });
  }

  try {
    // Only set headers and stream PDF if all checks pass
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=invoice-${paymentId}.pdf`);
    await generateInvoicePdf({
      paymentId: payment._id.toString().slice(-8), // Last 8 characters for invoice number
      date: payment.createdAt ? payment.createdAt.toLocaleDateString('en-US') : new Date().toLocaleDateString('en-US'),
      gigTitle: payment.contract?.title || payment.gig?.title || 'Professional Service',
      contractId: payment.contract?._id?.toString().slice(-8) || 'N/A',
      providerFirstName: payment.payer?.firstName || 'N/A',
      providerLastName: payment.payer?.lastName || '',
      providerEmail: payment.payer?.email || 'N/A',
      taskerFirstName: payment.payee?.firstName || 'N/A',
      taskerLastName: payment.payee?.lastName || '',
      taskerEmail: payment.payee?.email || 'N/A',
      amount: (payment.amount / 100).toFixed(2),
      currency: payment.currency || 'cad',
      platformFee: ((payment.applicationFeeAmount || 0) / 100).toFixed(2),
      tax: ((payment.taxAmount || 0) / 100).toFixed(2),
      providerTax: ((payment.providerTaxAmount || 0) / 100).toFixed(2),
      taskerTax: ((payment.taskerTaxAmount || 0) / 100).toFixed(2),
      totalProviderPayment: ((payment.totalProviderPayment || payment.amount) / 100).toFixed(2),
      payout: ((payment.amountReceivedByPayee || 0) / 100).toFixed(2),
    }, res, req.user.role);
  } catch (err) {
    logger.error('Failed to generate PDF invoice:', err);
    return res.status(500).json({ status: 'fail', message: 'Failed to generate PDF invoice.' });
  }
});

// --- Get Available Balance for Withdrawal ---
export const getBalance = catchAsync(async (req, res, next) => {
  const userId = req.user.id;

  // Get user with Stripe account ID
  const user = await User.findById(userId).select("+stripeAccountId");
  if (!user || !user.stripeAccountId) {
    return next(new AppError("Stripe account not connected. Please complete onboarding first.", 400));
  }

  try {
    // Retrieve the available balance from Stripe
    const balance = await stripe.balance.retrieve({
      stripeAccount: user.stripeAccountId,
    });

    // Find available balance for USD (or default currency)
    const available = balance.available.find(b => b.currency === 'usd') || { amount: 0, currency: 'usd' };
    const pending = balance.pending.find(b => b.currency === 'usd') || { amount: 0, currency: 'usd' };

    res.status(200).json({
      status: "success",
      data: {
        available: (available.amount / 100).toFixed(2),
        pending: (pending.amount / 100).toFixed(2),
        currency: available.currency.toUpperCase(),
        stripeAccountId: user.stripeAccountId,
      },
    });
  } catch (error) {
    logger.error(`Error retrieving balance for user ${userId}:`, error);
    return next(new AppError("Failed to retrieve balance from Stripe.", 500));
  }
});

// --- Process Withdrawal Request ---
export const processWithdrawal = catchAsync(async (req, res, next) => {
  const { amount } = req.body;
  const userId = req.user.id;

  // Validate amount
  if (!amount || amount <= 0) {
    return next(new AppError("Valid withdrawal amount is required.", 400));
  }

  // Get user with Stripe account ID
  const user = await User.findById(userId).select("+stripeAccountId");
  if (!user || !user.stripeAccountId) {
    return next(new AppError("Stripe account not connected. Please complete onboarding first.", 400));
  }

  try {
    // Check available balance first
    const balance = await stripe.balance.retrieve({
      stripeAccount: user.stripeAccountId,
    });

    const available = balance.available.find(b => b.currency === 'usd');
    const availableAmount = available ? available.amount : 0;
    const requestedAmount = Math.round(amount * 100); // Convert to cents

    if (requestedAmount > availableAmount) {
      return next(new AppError(`Insufficient balance. Available: $${(availableAmount / 100).toFixed(2)}, Requested: $${amount}`, 400));
    }

    // Create payout to user's connected bank account
    const payout = await stripe.payouts.create({
      amount: requestedAmount,
      currency: 'usd',
      method: 'instant', // Use instant payout if available, otherwise standard
    }, {
      stripeAccount: user.stripeAccountId,
    });

    // Log the withdrawal for tracking
    logger.info(`Withdrawal processed for user ${userId}: $${amount} (Payout ID: ${payout.id})`);

    // Create a withdrawal record in the database (optional)
    const withdrawalRecord = new Payment({
      payer: userId, // User withdrawing
      payee: userId, // User receiving
      amount: requestedAmount,
      currency: 'usd',
      status: payout.status,
      stripePayoutId: payout.id,
      description: `Withdrawal to bank account`,
      type: 'withdrawal',
      stripeConnectedAccountId: user.stripeAccountId, // Required for schema
      amountReceivedByPayee: requestedAmount, // Required for schema
      amountAfterTax: requestedAmount, // Required for schema
      applicationFeeAmount: 0, // Required for schema
      taxAmount: 0 // Required for schema
    });
    await withdrawalRecord.save();

    res.status(200).json({
      status: "success",
      message: "Withdrawal request submitted successfully",
      data: {
        payoutId: payout.id,
        amount: amount,
        status: payout.status,
        estimatedArrival: payout.arrival_date ? new Date(payout.arrival_date * 1000) : null,
      },
    });
  } catch (error) {
    logger.error(`Error processing withdrawal for user ${userId}:`, error);
    
    // Handle specific Stripe errors
    if (error.type === 'StripeError') {
      switch (error.code) {
        case 'insufficient_funds':
          return next(new AppError("Insufficient funds in your Stripe account.", 400));
        case 'account_invalid':
          return next(new AppError("Your Stripe account is not properly configured.", 400));
        case 'payout_not_allowed':
          return next(new AppError("Payouts are not enabled for your account.", 400));
        default:
          return next(new AppError(`Stripe error: ${error.message}`, 400));
      }
    }
    
    return next(new AppError("Failed to process withdrawal request.", 500));
  }
});
