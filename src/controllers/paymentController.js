import Stripe from "stripe";
import Payment from "../models/Payment.js";
import Contract from "../models/Contract.js";
import User from "../models/User.js";
import AppError from "../utils/AppError.js";
import catchAsync from "../utils/catchAsync.js";
import mongoose from "mongoose";
import Notification from '../models/Notification.js';
import logger from '../utils/logger.js';
import notifyAdmin from '../utils/notifyAdmin.js';
import PDFDocument from 'pdfkit';
import { Readable } from 'stream';
import { generateInvoicePdf } from '../utils/invoicePdf_with_logo.js';

// Initialize Stripe with the secret key from environment variables
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-04-10' });

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

    // Ensure that the provider has connected their Stripe account
    const provider = await User.findById(providerId);
    if (!provider.stripeAccountId)
      return next(new AppError("Provider must connect their Stripe account before making payments.", 400));

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
    // Calculate payment amount based on contract type
    let serviceAmountInCents;
    let paymentDescription;

    if (contract.isHourly) {
      // For hourly contracts, use actual hours worked
      if (!contract.actualHours || contract.actualHours <= 0) {
        return next(new AppError("No approved hours found for this hourly contract. Please ensure time entries are approved before payment.", 400));
      }
      serviceAmountInCents = Math.round(contract.totalHourlyPayment * 100);
      paymentDescription = `Payment for ${contract.actualHours} hours at $${contract.hourlyRate}/hr`;
    } else {
      // For fixed contracts, use agreed cost
      serviceAmountInCents = Math.round(contract.agreedCost * 100);
      paymentDescription = `Payment for fixed-price gig`;
    }

    if (serviceAmountInCents <= 0) {
      return next(new AppError("Invalid payment amount calculated.", 400));
    }

    // --- Stripe Tax Integration ---
    // 1. Ensure provider has a Stripe customer with address info
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
        description: paymentDescription,
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

    // 5. Create PaymentIntent with Stripe Connect parameters
    const paymentIntentParams = {
      amount: totalProviderPaymentAmount,
      currency: payment.currency,
      // capture_method: "manual", // Disabled for testing - using automatic capture
      customer: stripeCustomerId,
      payment_method_types: ['card'], // Explicitly specify payment methods instead of automatic
      // Stripe Connect parameters - properly configured for platform fees
      application_fee_amount: payment.applicationFeeAmount + payment.providerTaxAmount,
      transfer_data: { destination: taskerStripeAccountId },
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

// Handler for account.updated events
const handleAccountUpdated = async (account) => {
  try {
    console.log(`Account updated: ${account.id}`);

    // Find the user with this Stripe account ID
    const user = await User.findOne({ stripeAccountId: account.id });

    if (!user) {
      console.log(`No user found for Stripe account: ${account.id}`);
      return;
    }

    // Update user's Stripe account status
    user.stripeChargesEnabled = account.charges_enabled;
    user.stripePayoutsEnabled = account.payouts_enabled;

    // Check if onboarding is complete
    const onboardingComplete = account.details_submitted &&
      account.charges_enabled &&
      account.payouts_enabled;

    // If onboarding is complete, we can update the user's onboarding status
    if (onboardingComplete) {
      // For taskers, mark onboarding as complete
      if (user.role.includes('tasker')) {
        user.isTaskerOnboardingComplete = true;
      }
      // For providers, mark onboarding as complete
      if (user.role.includes('provider')) {
        user.isProviderOnboardingComplete = true;
      }
    }

    // Save the updated user
    await user.save({ validateBeforeSave: false });

    console.log(`✅ User ${user._id} Stripe account status updated. Onboarding complete: ${onboardingComplete}`);

    // Check if user needs to complete additional requirements
    if (account.currently_due && account.currently_due.length > 0) {
      console.log(`Account ${account.id} has outstanding requirements:`, account.currently_due);
      // You could send a notification to the user here
      // await notifyUserToCompleteOnboarding(user, account.currently_due);
    }

    // Check for future requirements that need attention
    if (account.eventually_due && account.eventually_due.length > 0) {
      console.log(`Account ${account.id} has future requirements:`, account.eventually_due);
    }
  } catch (error) {
    console.error(`❌ Error handling account.updated event: ${error.message}`);
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
    case "account.updated":
      await handleAccountUpdated(dataObject);
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

    // DO NOT automatically update contract status
    // Contract status will be updated manually through the contract controller
    // when the provider explicitly approves and pays the tasker
    
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

  // Determine user role in this payment (provider or tasker)
  let userRole = 'admin'; // Default for admin users
  if (req.user.id === payment.payer._id.toString()) {
    userRole = 'provider';
  } else if (req.user.id === payment.payee._id.toString()) {
    userRole = 'tasker';
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
    }, res, userRole);
  } catch (err) {
    logger.error('Failed to generate PDF invoice:', err);
    return res.status(500).json({ status: 'fail', message: 'Failed to generate PDF invoice.' });
  }
});

// --- Get Available Balance for Withdrawal (Taskers only) ---
export const getBalance = catchAsync(async (req, res, next) => {
  const userId = req.user.id;

  // Get user with Stripe account ID
  const user = await User.findById(userId).select("+stripeAccountId");
  if (!user || !user.stripeAccountId) {
    return next(new AppError("Stripe account not connected. Please complete onboarding first.", 400));
  }

  try {
    let availableAmount = 0;
    let pendingAmount = 0;

    if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
      // In development mode, calculate balance from our payment records
      // This accounts for simulated transfers and withdrawals
      
      // Get all payments received by this user
      const paymentsReceived = await Payment.find({
        payee: userId,
        status: 'succeeded',
        type: 'payment'
      });

      // Get all withdrawals made by this user
      const withdrawals = await Payment.find({
        payer: userId,
        status: { $in: ['paid', 'succeeded'] },
        type: 'withdrawal'
      });

      // Calculate total received
      const totalReceived = paymentsReceived.reduce((sum, payment) => {
        return sum + (payment.amountReceivedByPayee || 0);
      }, 0);

      // Calculate total withdrawn
      const totalWithdrawn = withdrawals.reduce((sum, withdrawal) => {
        return sum + (withdrawal.amount || 0);
      }, 0);

      // Available balance = received - withdrawn
      availableAmount = totalReceived - totalWithdrawn;

      console.log(`[DEV MODE] Calculated balance for user ${userId}:
        - Payments received: ${paymentsReceived.length} ($${(totalReceived / 100).toFixed(2)})
        - Withdrawals made: ${withdrawals.length} ($${(totalWithdrawn / 100).toFixed(2)})
        - Available balance: $${(availableAmount / 100).toFixed(2)}`);

    } else {
      // In production mode, get real balance from Stripe
      const balance = await stripe.balance.retrieve({
        stripeAccount: user.stripeAccountId,
      });

      const available = balance.available.find(b => b.currency === 'usd') || { amount: 0, currency: 'usd' };
      const pending = balance.pending.find(b => b.currency === 'usd') || { amount: 0, currency: 'usd' };
      
      availableAmount = available.amount;
      pendingAmount = pending.amount;
    }

    res.status(200).json({
      status: "success",
      data: {
        available: (availableAmount / 100).toFixed(2),
        pending: (pendingAmount / 100).toFixed(2),
        currency: 'USD',
        stripeAccountId: user.stripeAccountId,
      },
    });
  } catch (error) {
    logger.error(`Error retrieving balance for user ${userId}:`, error);
    return next(new AppError("Failed to retrieve balance from Stripe.", 500));
  }
});

// --- Get Comprehensive Earnings Summary ---
export const getEarningsSummary = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const { period = 'all', startDate, endDate } = req.query;

  const user = await User.findById(userId).select("+stripeAccountId role");
  if (!user) {
    return next(new AppError("User not found.", 404));
  }

  try {
    // Build date filter
    let dateFilter = {};
    if (period !== 'all') {
      const now = new Date();
      switch (period) {
        case 'week':
          dateFilter.createdAt = { $gte: new Date(now.setDate(now.getDate() - 7)) };
          break;
        case 'month':
          dateFilter.createdAt = { $gte: new Date(now.setMonth(now.getMonth() - 1)) };
          break;
        case 'year':
          dateFilter.createdAt = { $gte: new Date(now.setFullYear(now.getFullYear() - 1)) };
          break;
        case 'custom':
          if (startDate && endDate) {
            dateFilter.createdAt = {
              $gte: new Date(startDate),
              $lte: new Date(endDate)
            };
          }
          break;
      }
    }

    let summary = {};

    // For Taskers - Money they've earned
    if (user.role.includes('tasker')) {
      const taskerPayments = await Payment.aggregate([
        {
          $match: {
            payee: new mongoose.Types.ObjectId(userId),
            status: 'succeeded',
            type: 'payment',
            ...dateFilter
          }
        },
        {
          $group: {
            _id: null,
            totalEarned: { $sum: '$amountReceivedByPayee' },
            totalContracts: { $sum: 1 },
            totalTaxesPaid: { $sum: '$taskerTaxAmount' },
            averageEarning: { $avg: '$amountReceivedByPayee' }
          }
        }
      ]);

      const withdrawals = await Payment.aggregate([
        {
          $match: {
            payer: new mongoose.Types.ObjectId(userId),
            type: 'withdrawal',
            status: 'succeeded',
            ...dateFilter
          }
        },
        {
          $group: {
            _id: null,
            totalWithdrawn: { $sum: '$amount' },
            withdrawalCount: { $sum: 1 }
          }
        }
      ]);

      summary.tasker = {
        totalEarned: taskerPayments[0]?.totalEarned || 0,
        totalEarnedFormatted: ((taskerPayments[0]?.totalEarned || 0) / 100).toFixed(2),
        totalContracts: taskerPayments[0]?.totalContracts || 0,
        totalTaxesPaid: taskerPayments[0]?.totalTaxesPaid || 0,
        totalTaxesPaidFormatted: ((taskerPayments[0]?.totalTaxesPaid || 0) / 100).toFixed(2),
        averageEarning: taskerPayments[0]?.averageEarning || 0,
        averageEarningFormatted: ((taskerPayments[0]?.averageEarning || 0) / 100).toFixed(2),
        totalWithdrawn: withdrawals[0]?.totalWithdrawn || 0,
        totalWithdrawnFormatted: ((withdrawals[0]?.totalWithdrawn || 0) / 100).toFixed(2),
        withdrawalCount: withdrawals[0]?.withdrawalCount || 0,
        pendingBalance: 0, // Will be filled from Stripe
        availableBalance: 0 // Will be filled from Stripe
      };

      // Get Stripe balance if account is connected
      if (user.stripeAccountId) {
        try {
          const balance = await stripe.balance.retrieve({
            stripeAccount: user.stripeAccountId,
          });
          const available = balance.available.find(b => b.currency === 'usd') || { amount: 0 };
          const pending = balance.pending.find(b => b.currency === 'usd') || { amount: 0 };

          summary.tasker.availableBalance = available.amount;
          summary.tasker.availableBalanceFormatted = (available.amount / 100).toFixed(2);
          summary.tasker.pendingBalance = pending.amount;
          summary.tasker.pendingBalanceFormatted = (pending.amount / 100).toFixed(2);
        } catch (stripeError) {
          console.error('Error fetching Stripe balance:', stripeError);
        }
      }
    }

    // For Providers - Money they've spent
    if (user.role.includes('provider')) {
      const providerPayments = await Payment.aggregate([
        {
          $match: {
            payer: new mongoose.Types.ObjectId(userId),
            status: 'succeeded',
            type: 'payment',
            ...dateFilter
          }
        },
        {
          $group: {
            _id: null,
            totalSpent: { $sum: '$totalProviderPayment' },
            totalServiceCosts: { $sum: '$amount' },
            totalPlatformFees: { $sum: '$applicationFeeAmount' },
            totalTaxesPaid: { $sum: '$providerTaxAmount' },
            totalContracts: { $sum: 1 },
            averageSpent: { $avg: '$totalProviderPayment' }
          }
        }
      ]);

      summary.provider = {
        totalSpent: providerPayments[0]?.totalSpent || 0,
        totalSpentFormatted: ((providerPayments[0]?.totalSpent || 0) / 100).toFixed(2),
        totalServiceCosts: providerPayments[0]?.totalServiceCosts || 0,
        totalServiceCostsFormatted: ((providerPayments[0]?.totalServiceCosts || 0) / 100).toFixed(2),
        totalPlatformFees: providerPayments[0]?.totalPlatformFees || 0,
        totalPlatformFeesFormatted: ((providerPayments[0]?.totalPlatformFees || 0) / 100).toFixed(2),
        totalTaxesPaid: providerPayments[0]?.totalTaxesPaid || 0,
        totalTaxesPaidFormatted: ((providerPayments[0]?.totalTaxesPaid || 0) / 100).toFixed(2),
        totalContracts: providerPayments[0]?.totalContracts || 0,
        averageSpent: providerPayments[0]?.averageSpent || 0,
        averageSpentFormatted: ((providerPayments[0]?.averageSpent || 0) / 100).toFixed(2)
      };
    }

    res.status(200).json({
      status: "success",
      data: {
        period,
        summary,
        currency: 'USD'
      }
    });

  } catch (error) {
    console.error('Error getting earnings summary:', error);
    return next(new AppError("Failed to retrieve earnings summary.", 500));
  }
});

// --- Get Detailed Payment History ---
export const getPaymentHistory = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const {
    page = 1,
    limit = 10,
    type = 'all', // 'earned', 'spent', 'withdrawals', 'all'
    status = 'all',
    startDate,
    endDate
  } = req.query;

  const user = await User.findById(userId).select("role");
  if (!user) {
    return next(new AppError("User not found.", 404));
  }

  try {
    // Build query filter
    let matchFilter = {};

    // Date filter
    if (startDate && endDate) {
      matchFilter.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    // Status filter
    if (status !== 'all') {
      matchFilter.status = status;
    }

    // Type and role-based filtering
    let queries = [];

    if (type === 'all' || type === 'earned') {
      if (user.role.includes('tasker')) {
        queries.push({
          ...matchFilter,
          payee: new mongoose.Types.ObjectId(userId),
          type: 'payment'
        });
      }
    }

    if (type === 'all' || type === 'spent') {
      if (user.role.includes('provider')) {
        queries.push({
          ...matchFilter,
          payer: new mongoose.Types.ObjectId(userId),
          type: 'payment'
        });
      }
    }

    if (type === 'all' || type === 'withdrawals') {
      if (user.role.includes('tasker')) {
        queries.push({
          ...matchFilter,
          payer: new mongoose.Types.ObjectId(userId),
          type: 'withdrawal'
        });
      }
    }

    if (queries.length === 0) {
      return res.status(200).json({
        status: "success",
        data: {
          payments: [],
          pagination: {
            currentPage: 1,
            totalPages: 0,
            totalItems: 0,
            itemsPerPage: parseInt(limit)
          }
        }
      });
    }

    // Combine queries with $or
    const finalFilter = queries.length === 1 ? queries[0] : { $or: queries };

    // Get total count
    const totalItems = await Payment.countDocuments(finalFilter);
    const totalPages = Math.ceil(totalItems / limit);

    // Get payments with pagination
    const payments = await Payment.find(finalFilter)
      .populate('contract', 'gig status')
      .populate('gig', 'title')
      .populate('payer', 'firstName lastName email')
      .populate('payee', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    // Format payments for response
    const formattedPayments = payments.map(payment => ({
      _id: payment._id, // Include _id for invoice generation
      id: payment._id,  // Keep id for backward compatibility
      type: payment.type,
      status: payment.status,
      amount: payment.amount,
      amountFormatted: (payment.amount / 100).toFixed(2),
      amountReceivedByPayee: payment.amountReceivedByPayee,
      amountReceivedFormatted: (payment.amountReceivedByPayee / 100).toFixed(2),
      totalProviderPayment: payment.totalProviderPayment,
      totalProviderPaymentFormatted: (payment.totalProviderPayment / 100).toFixed(2),
      applicationFeeAmount: payment.applicationFeeAmount,
      applicationFeeFormatted: (payment.applicationFeeAmount / 100).toFixed(2),
      taxAmount: payment.taxAmount,
      taxAmountFormatted: (payment.taxAmount / 100).toFixed(2),
      currency: payment.currency.toUpperCase(),
      description: payment.description,
      createdAt: payment.createdAt,
      succeededAt: payment.succeededAt,
      contract: payment.contract,
      gig: payment.gig,
      payer: payment.payer,
      payee: payment.payee,
      // Determine user's role in this payment
      userRole: payment.payer._id.toString() === userId ? 'payer' : 'payee'
    }));

    res.status(200).json({
      status: "success",
      data: {
        payments: formattedPayments,
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalItems,
          itemsPerPage: parseInt(limit)
        }
      }
    });

  } catch (error) {
    console.error('Error getting payment history:', error);
    return next(new AppError("Failed to retrieve payment history.", 500));
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

  let availableAmount = 0; // Move this outside the try block
  const requestedAmount = Math.round(amount * 100); // Convert to cents

  try {
    if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
      // In development mode, calculate balance from our payment records
      
      // Get all payments received by this user
      const paymentsReceived = await Payment.find({
        payee: userId,
        status: 'succeeded',
        type: 'payment'
      });

      // Get all withdrawals made by this user
      const withdrawals = await Payment.find({
        payer: userId,
        status: { $in: ['paid', 'succeeded'] },
        type: 'withdrawal'
      });

      // Calculate available balance
      const totalReceived = paymentsReceived.reduce((sum, payment) => {
        return sum + (payment.amountReceivedByPayee || 0);
      }, 0);

      const totalWithdrawn = withdrawals.reduce((sum, withdrawal) => {
        return sum + (withdrawal.amount || 0);
      }, 0);

      availableAmount = totalReceived - totalWithdrawn;

      console.log(`[DEV MODE] Withdrawal check for user ${userId}:
        - Total received: $${(totalReceived / 100).toFixed(2)}
        - Total withdrawn: $${(totalWithdrawn / 100).toFixed(2)}
        - Available: $${(availableAmount / 100).toFixed(2)}
        - Requested: $${amount}`);

    } else {
      // In production mode, get real balance from Stripe
      const balance = await stripe.balance.retrieve({
        stripeAccount: user.stripeAccountId,
      });

      const available = balance.available.find(b => b.currency === 'usd');
      availableAmount = available ? available.amount : 0;
    }

    if (requestedAmount > availableAmount) {
      return next(new AppError(`Insufficient balance. Available: ${(availableAmount / 100).toFixed(2)}, Requested: ${amount}`, 400));
    }

    let payout;
    let payoutId;

    if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
      // Simulate payout in development mode
      payoutId = `po_dev_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      payout = {
        id: payoutId,
        status: 'paid',
        arrival_date: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours from now
      };
      
      console.log(`[DEV MODE] Simulated withdrawal:
        - Payout ID: ${payoutId}
        - Amount: $${amount}
        - Status: simulated_paid`);

    } else {
      // Create real payout in production
      payout = await stripe.payouts.create({
        amount: requestedAmount,
        currency: 'usd',
        method: 'instant',
      }, {
        stripeAccount: user.stripeAccountId,
      });
      payoutId = payout.id;
    }

    // Log the withdrawal for tracking
    logger.info(`Withdrawal processed for user ${userId}: ${amount} (Payout ID: ${payoutId})`);

    // Create a withdrawal record in the database
    const withdrawalData = {
      payer: userId, // User withdrawing
      payee: userId, // User receiving
      amount: requestedAmount,
      currency: 'usd',
      status: payout.status,
      stripePayoutId: payoutId,
      description: `Withdrawal to bank account`,
      type: 'withdrawal',
      stripeConnectedAccountId: user.stripeAccountId,
      amountReceivedByPayee: requestedAmount,
      amountAfterTax: requestedAmount,
      applicationFeeAmount: 0,
      taxAmount: 0
    };
    
    // Explicitly don't set contract and gig for withdrawals to avoid unique constraint issues
    const withdrawalRecord = new Payment(withdrawalData);
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
    console.error(`[ERROR] Withdrawal processing failed for user ${userId}:`, {
      errorMessage: error.message,
      errorStack: error.stack,
      errorType: error.type,
      errorCode: error.code,
      requestedAmount: amount,
      availableAmount: availableAmount / 100
    });
    
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

    return next(new AppError(`Failed to process withdrawal request: ${error.message}`, 500));
  }
});

// --- Check Onboarding Status ---
export const checkOnboardingStatus = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user.id).select("+stripeAccountId");

  if (!user) {
    return next(new AppError("User not found.", 404));
  }

  if (!user.stripeAccountId) {
    return res.status(200).json({
      status: "success",
      data: {
        onboardingComplete: false,
        message: "No Stripe account connected"
      }
    });
  }

  try {
    // Retrieve the account from Stripe
    const account = await stripe.accounts.retrieve(user.stripeAccountId);

    // Check if onboarding is complete
    const onboardingComplete = account.details_submitted &&
      account.charges_enabled &&
      account.payouts_enabled;

    // Get account requirements if onboarding is not complete
    let requirements = null;
    if (!onboardingComplete && account.requirements) {
      requirements = {
        currentlyDue: account.requirements.currently_due,
        eventuallyDue: account.requirements.eventually_due,
        pastDue: account.requirements.past_due,
        disabledReason: account.requirements.disabled_reason,
      };
    }

    res.status(200).json({
      status: "success",
      data: {
        onboardingComplete,
        accountId: user.stripeAccountId,
        detailsSubmitted: account.details_submitted,
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
        requirements,
        capabilities: {
          cardPayments: account.capabilities?.card_payments,
          transfers: account.capabilities?.transfers,
        },
        message: onboardingComplete
          ? "Onboarding complete"
          : "Onboarding incomplete"
      }
    });
  } catch (error) {
    console.error("Error checking onboarding status:", error);

    // Handle specific Stripe errors
    if (error.type === 'StripePermissionError' && error.code === 'account_invalid') {
      // The account doesn't exist or is invalid, clear it from the user
      user.stripeAccountId = undefined;
      await user.save({ validateBeforeSave: false });

      return res.status(200).json({
        status: "success",
        data: {
          onboardingComplete: false,
          message: "Previous Stripe account was invalid and has been cleared"
        }
      });
    }

    return next(new AppError("Could not check onboarding status.", 500));
  }
});

// --- Get Onboarding Requirements ---
export const getOnboardingRequirements = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user.id).select("+stripeAccountId");

  if (!user) {
    return next(new AppError("User not found.", 404));
  }

  if (!user.stripeAccountId) {
    return next(new AppError("No Stripe account connected.", 400));
  }

  try {
    // Retrieve the account from Stripe
    const account = await stripe.accounts.retrieve(user.stripeAccountId);

    // Get account requirements
    const requirements = {
      currentlyDue: account.requirements?.currently_due || [],
      eventuallyDue: account.requirements?.eventually_due || [],
      pastDue: account.requirements?.past_due || [],
      disabledReason: account.requirements?.disabled_reason || null,
    };

    // Check capability statuses
    const capabilities = {
      cardPayments: account.capabilities?.card_payments || 'inactive',
      transfers: account.capabilities?.transfers || 'inactive',
    };

    res.status(200).json({
      status: "success",
      data: {
        accountId: user.stripeAccountId,
        detailsSubmitted: account.details_submitted,
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
        requirements,
        capabilities,
        businessProfile: {
          name: account.business_profile?.name || null,
          url: account.business_profile?.url || null,
        }
      }
    });
  } catch (error) {
    console.error("Error getting onboarding requirements:", error);

    // Handle specific Stripe errors
    if (error.type === 'StripePermissionError' && error.code === 'account_invalid') {
      // The account doesn't exist or is invalid, clear it from the user
      user.stripeAccountId = undefined;
      await user.save({ validateBeforeSave: false });

      return next(new AppError("Your Stripe account is invalid and has been cleared. Please create a new one.", 400));
    }

    return next(new AppError("Could not retrieve onboarding requirements.", 500));
  }
});

// --- Create Stripe Connected Account for User ---
export const createConnectedAccount = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user.id);
  if (!user) return next(new AppError("User not found.", 404));

  // If user already has a Stripe account, return the existing account info
  if (user.stripeAccountId) {
    // Retrieve the existing account to check its status
    try {
      const account = await stripe.accounts.retrieve(user.stripeAccountId);

      // Check if the account is fully onboarded
      const isOnboarded = account.details_submitted &&
        account.charges_enabled &&
        account.payouts_enabled;

      return res.status(200).json({
        status: "success",
        message: "Connected account already exists",
        data: {
          accountId: user.stripeAccountId,
          isOnboarded,
          detailsSubmitted: account.details_submitted,
          chargesEnabled: account.charges_enabled,
          payoutsEnabled: account.payouts_enabled,
          accountLinkNeeded: !isOnboarded
        }
      });
    } catch (error) {
      // If account retrieval fails, we'll create a new one
      // Continue to create a new account
    }
  }

  try {
    // Prepare account creation data with prefilled information
    const accountData = {
      type: "express",
      country: "CA", // Default to Canada, but can be changed based on user's location
      email: user.email,
      business_type: "individual",
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      settings: {
        payouts: {
          schedule: {
            interval: "manual", // Platform will trigger payouts manually
          },
        },
      },
    };

    // Prefill individual information if available
    if (user.firstName || user.lastName) {
      accountData.individual = {};
      if (user.firstName) accountData.individual.first_name = user.firstName;
      if (user.lastName) accountData.individual.last_name = user.lastName;
      if (user.email) accountData.individual.email = user.email;

      // Add phone if available
      if (user.phone) accountData.individual.phone = user.phone;
    }

    // Create a new Stripe Express account
    const account = await stripe.accounts.create(accountData);

    // Save the account ID to the user document
    user.stripeAccountId = account.id;
    await user.save({ validateBeforeSave: false });

    // Check if the account is fully onboarded (should be false for a new account)
    const isOnboarded = account.details_submitted &&
      account.charges_enabled &&
      account.payouts_enabled;

    res.status(201).json({
      status: "success",
      message: "Connected account created successfully",
      data: {
        accountId: account.id,
        isOnboarded,
        detailsSubmitted: account.details_submitted,
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
        accountLinkNeeded: !isOnboarded
      }
    });
  } catch (error) {
    console.error('Create Connected Account Error:', {
      type: error.type,
      code: error.code,
      message: error.message
    });
    return next(new AppError("Could not create connected account. Please try again.", 500));
  }
});

// --- Initiate Account Session for Onboarding ---
export const initiateAccountSession = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user.id).select("+stripeAccountId");

  if (!user) {
    return next(new AppError("User not found.", 404));
  }

  if (!user.stripeAccountId) {
    return next(new AppError("No connected Stripe account found. Please create one first.", 400));
  }

  try {
    // Retrieve the account to verify it exists
    const account = await stripe.accounts.retrieve(user.stripeAccountId);

    // Check if the request is for embedded onboarding (based on a query parameter or header)
    const useEmbedded = req.query.embedded === 'true' || req.get('X-Embedded-Onboarding') === 'true';

    if (useEmbedded) {
      // Create an Account Session for embedded onboarding
      const accountSession = await stripe.accountSessions.create({
        account: user.stripeAccountId,
        components: {
          account_onboarding: {
            enabled: true,
            features: {
              // For Express accounts, external_account_collection is enabled by default
              // and cannot be disabled - this is required for bank account collection
              external_account_collection: true,
            },
          },
        },
      });

      // Validate the client secret format
      const isValidFormat = accountSession.client_secret &&
        accountSession.client_secret.startsWith('accs_secret__') &&
        accountSession.client_secret.length === 60;

      if (!isValidFormat) {
        return next(new AppError("Invalid client secret format generated by Stripe", 500));
      }

      // Check account status
      const isOnboarded = account.details_submitted &&
        account.charges_enabled &&
        account.payouts_enabled;
      res.status(200).json({
        status: "success",
        data: {
          clientSecret: accountSession.client_secret,
          accountId: user.stripeAccountId,
          isOnboarded,
          detailsSubmitted: account.details_submitted,
          chargesEnabled: account.charges_enabled,
          payoutsEnabled: account.payouts_enabled,
        }
      });
    } else {
      // Create an Account Link for redirect-based onboarding (fallback approach)
      // This is more reliable than embedded checkout
      const accountLink = await stripe.accountLinks.create({
        account: user.stripeAccountId,
        refresh_url: `${process.env.FRONTEND_URL}/settings?tab=payment&onboarding_status=refresh`,
        return_url: `${process.env.FRONTEND_URL}/settings?tab=payment&onboarding_status=success`,
        type: "account_onboarding",
      });

      // Check account status
      const isOnboarded = account.details_submitted &&
        account.charges_enabled &&
        account.payouts_enabled;

      res.status(200).json({
        status: "success",
        data: {
          url: accountLink.url,
          accountId: user.stripeAccountId,
          isOnboarded,
          detailsSubmitted: account.details_submitted,
          chargesEnabled: account.charges_enabled,
          payoutsEnabled: account.payouts_enabled,
        }
      });
    }
  } catch (error) {
    // Handle specific Stripe errors
    if (error.type === 'StripePermissionError' && error.code === 'account_invalid') {
      // The account doesn't exist or is invalid, clear it from the user
      user.stripeAccountId = undefined;
      await user.save({ validateBeforeSave: false });

      return next(new AppError("Your Stripe account is invalid and has been cleared. Please create a new one.", 400));
    }

    // Log the error for debugging
    console.error('Stripe Account Session Error:', {
      type: error.type,
      code: error.code,
      message: error.message
    });

    return next(new AppError("Could not initiate onboarding session. Please try again.", 500));
  }
});