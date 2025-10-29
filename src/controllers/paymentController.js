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
import { generateInvoicePdf } from '../utils/invoicePdfWithLogo.js';
import https from 'https';
import { URL } from 'url';

// Import Nuvei Payment Service
import nuveiPaymentService from '../services/payment/NuveiPaymentService.js';
import nuveiPayoutService from '../services/payment/NuveiPayoutService.js';

// Import Stripe Payment Service
import stripePaymentService from '../services/payment/StripePaymentService.js';

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
    const result = await stripePaymentService.releasePaymentForContract(contractId, providerId);
    
    res.status(200).json({
      status: "success",
      ...result
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
export const createPaymentIntentForContract = catchAsync(async (req, res, next) => {
  const { contractId } = req.params;
  const { paymentMethod } = req.body || {}; // 'stripe' or 'nuvei'
  const providerId = req.user.id;

  try {
    let result;
    
    // Check which payment method the provider wants to use
    if (paymentMethod === 'nuvei') {
      // Use Nuvei Simply Connect payment service
      result = await nuveiPaymentService.createSimplyConnectSession(contractId, providerId, req.body.amount, req.body.currency);
    } else {
      // Default to Stripe
      result = await stripePaymentService.createPaymentIntentForContract(contractId, providerId);
    }
    
    res.status(200).json({
      status: "success",
      ...result
    });
  } catch (error) {
    console.error('Error creating payment intent:', error);
    return next(new AppError(`Failed to create payment intent: ${error.message}`, 500));
  }
});

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
  const { amount, paymentMethod = 'stripe' } = req.body; // Added paymentMethod parameter
  const userId = req.user.id;

  // Validate amount
  if (!amount || amount <= 0) {
    return next(new AppError("Valid withdrawal amount is required.", 400));
  }

  if (!['stripe', 'nuvei'].includes(paymentMethod)) {
    return next(new AppError("Invalid payment method. Use 'stripe' or 'nuvei'.", 400));
  }

  try {
    let result;
    
    if (paymentMethod === 'stripe') {
      // Process withdrawal via Stripe (using new service)
      // Process withdrawal via Stripe (using new service)
      result = await stripePaymentService.processWithdrawal(userId, amount);
    } else if (paymentMethod === 'nuvei') {
      // Process withdrawal via Nuvei bank transfer
      result = await nuveiPayoutService.processNuveiWithdrawal(userId, amount);
      
      if (!result.success) {
        return next(new AppError(result.error, 400));
      }
    }

    res.status(200).json({
      status: "success",
      message: "Withdrawal request submitted successfully",
      data: result,
    });
  } catch (error) {
    console.error(`[ERROR] Withdrawal processing failed for user ${userId}:`, {
      errorMessage: error.message,
      errorStack: error.stack,
      errorType: error.type,
      errorCode: error.code,
      requestedAmount: amount,
      paymentMethod
    });
    
    logger.error(`Error processing ${paymentMethod} withdrawal for user ${userId}:`, error);

    if (error instanceof AppError) {
      return next(error);
    } else if (error.type === 'StripeError') {
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

// --- Get Nuvei withdrawal history ---
export const getNuveiWithdrawalHistory = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const { page = 1, limit = 10 } = req.query;

  try {
    const result = await nuveiPayoutService.getUserNuveiWithdrawals(userId, parseInt(page), parseInt(limit));

    res.status(200).json({
      status: "success",
      data: result
    });
  } catch (error) {
    logger.error('Error getting Nuvei withdrawal history:', error);
    return next(new AppError(`Failed to get Nuvei withdrawal history: ${error.message}`, 500));
  }
});

// --- Get available balance by payment method ---
export const getPaymentMethodBalance = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const { paymentMethod = 'both' } = req.query; // 'stripe', 'nuvei', or 'both'

  try {
    const balances = {};

    if (paymentMethod === 'both' || paymentMethod === 'stripe') {
      const user = await User.findById(userId).select("+stripeAccountId");
      if (user && user.stripeAccountId) {
        if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
          // In development, calculate from records
          const paymentsReceived = await Payment.find({
            payee: userId,
            status: 'succeeded',
            type: 'payment'
          });

          const withdrawals = await Payment.find({
            payer: userId,
            status: { $in: ['paid', 'succeeded'] },
            type: 'withdrawal'
          });

          const totalReceived = paymentsReceived.reduce((sum, payment) => {
            return sum + (payment.amountReceivedByPayee || 0);
          }, 0);

          const totalWithdrawn = withdrawals.reduce((sum, withdrawal) => {
            return sum + (withdrawal.amount || 0);
          }, 0);

          const available = totalReceived - totalWithdrawn;

          balances.stripe = {
            available: available / 100,
            availableFormatted: (available / 100).toFixed(2),
            currency: 'USD',
            hasAccount: true
          };
        } else {
          // In production, get from Stripe API
          const balance = await stripe.balance.retrieve({
            stripeAccount: user.stripeAccountId,
          });

          const availableUSD = balance.available.find(b => b.currency === 'usd') || { amount: 0 };
          const pendingUSD = balance.pending.find(b => b.currency === 'usd') || { amount: 0 };

          balances.stripe = {
            available: availableUSD.amount / 100,
            availableFormatted: (availableUSD.amount / 100).toFixed(2),
            pending: pendingUSD.amount / 100,
            pendingFormatted: (pendingUSD.amount / 100).toFixed(2),
            currency: 'USD',
            hasAccount: true
          };
        }
      } else {
        balances.stripe = {
          available: 0,
          availableFormatted: '0.00',
          pending: 0,
          pendingFormatted: '0.00',
          currency: 'USD',
          hasAccount: false
        };
      }
    }

    if (paymentMethod === 'both' || paymentMethod === 'nuvei') {
      const user = await User.findById(userId);
      if (user && user.nuveiBankTransferEnabled) {
        const available = await nuveiPayoutService.getNuveiAvailableBalance(userId);
        
        balances.nuvei = {
          available: available / 100,
          availableFormatted: (available / 100).toFixed(2),
          currency: 'CAD',
          hasAccount: user.nuveiBankTransferEnabled,
          hasBankDetails: !!(user.nuveiBankDetails && user.nuveiBankDetails.accountNumber)
        };
      } else {
        balances.nuvei = {
          available: 0,
          availableFormatted: '0.00',
          currency: 'CAD',
          hasAccount: false,
          hasBankDetails: false
        };
      }
    }

    res.status(200).json({
      status: "success",
      data: {
        balances,
        paymentMethod,
        userId
      }
    });
  } catch (error) {
    logger.error('Error getting payment method balance:', error);
    return next(new AppError(`Failed to get balance: ${error.message}`, 500));
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

// === NUVEI PAYMENT FUNCTIONS ===

// Utility function to make HTTP requests to Nuvei API
const makeNuveiRequest = async (endpoint, data, method = 'POST') => {
  const nuveiUrl = process.env.NODE_ENV === 'production' 
    ? process.env.NUVEI_API_URL || 'https://api.nuvei.com/' 
    : process.env.NUVEI_SANDBOX_URL || 'https://sandbox.nuvei.com/';
  
  const apiUrl = new URL(endpoint, nuveiUrl);
  
  const headers = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(JSON.stringify(data)),
    'Authorization': `Bearer ${process.env.NUVEI_API_KEY}`, // or however Nuvei authenticates
  };
  
  const options = {
    hostname: apiUrl.hostname,
    port: apiUrl.port || 443,
    path: apiUrl.pathname + apiUrl.search,
    method,
    headers,
  };
  
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(JSON.parse(data));
          } else {
            reject(new Error(`HTTP error! status: ${res.statusCode}, message: ${data}`));
          }
        } catch (error) {
          reject(error);
        }
      });
    });
    
    req.on('error', (error) => {
      console.error('Nuvei API request failed:', error);
      reject(error);
    });
    
    if (method !== 'GET' && method !== 'HEAD') {
      req.write(JSON.stringify(data));
    }
    
    req.end();
  });
};

// Create a Nuvei payment session for a contract
export const createNuveiPaymentSession = catchAsync(async (req, res, next) => {
  const { contractId } = req.body; // changed from req.params for POST
  const providerId = req.user.id;
  const { paymentMethod = 'card' } = req.body; // Get payment method from request, default to card

  try {
    const result = await nuveiPaymentService.createPaymentSession(contractId, providerId, paymentMethod);
    
    res.status(200).json({
      status: "success",
      data: result,
    });
  } catch (error) {
    console.error('Error creating Nuvei payment session:', error);
    return next(new AppError(`Failed to create Nuvei payment session: ${error.message}`, 500));
  }
});
export const getNuveiPaymentSession = catchAsync(async (req, res, next) => {
  const { sessionId } = req.params;
  const userId = req.user.id;

  try {
    // Check authorization - only involved parties can access
    // For now, let the service handle the authorization check
    const result = await nuveiPaymentService.getPaymentBySessionId(sessionId);
    
    // Additional authorization check
    if (![result.payer._id.toString(), result.payee._id.toString()].includes(userId) && 
        !req.user.role.includes('admin')) {
      return next(new AppError("Not authorized to access this payment session.", 403));
    }

    res.status(200).json({
      status: "success",
      data: result
    });
  } catch (error) {
    console.error('Error getting Nuvei payment session:', error);
    return next(new AppError(`Failed to get Nuvei payment session: ${error.message}`, 500));
  }
});

// Confirm Nuvei payment (called after payment completion on frontend)
export const confirmNuveiPayment = catchAsync(async (req, res, next) => {
  const { nuveiTransactionId, sessionId } = req.body;

  if (!nuveiTransactionId && !sessionId) {
    return next(new AppError('Nuvei transaction ID or session ID is required', 400));
  }

  try {
    const result = await nuveiPaymentService.confirmPayment(nuveiTransactionId, sessionId);
    
    res.status(200).json({
      status: "success",
      message: "Nuvei payment confirmed and contract updated",
      data: result
    });
  } catch (error) {
    console.error('Error confirming Nuvei payment:', error);
    return next(new AppError('Failed to confirm Nuvei payment', 500));
  }
});

// Handle Nuvei webhook for payment confirmations
export const handleNuveiWebhook = catchAsync(async (req, res, next) => {
  const payload = req.body;
  const sig = req.headers['x-nuvei-signature']; // Assuming Nuvei uses this header

  // Verify webhook signature (implementation depends on Nuvei's signature method)
  // In a real implementation, you would verify the signature here
  // For now, we'll skip signature verification for development purposes

  try {
    // Log the received webhook for debugging
    console.log('Nuvei webhook received:', JSON.stringify(payload, null, 2));

    // Handle different event types
    const eventType = payload.type || payload.event_type || 'unknown';
    const transactionId = payload.transactionId || payload.txnId || payload.id;

    switch (eventType) {
      case 'payment_success':
      case 'payment.succeeded':
        await handleNuveiPaymentSuccess(payload, transactionId);
        break;
        
      case 'payment_failed':
      case 'payment.failed':
        await handleNuveiPaymentFailed(payload, transactionId);
        break;
        
      case 'refund_completed':
      case 'refund.completed':
        await handleNuveiRefundCompleted(payload, transactionId);
        break;
        
      default:
        console.log(`Unhandled Nuvei event type: ${eventType}`);
        break;
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('Error processing Nuvei webhook:', error);
    res.status(400).json({ error: 'Webhook error', message: error.message });
  }
});

// Handler for Nuvei payment success event
const handleNuveiPaymentSuccess = async (data, transactionId) => {
  try {
    // Find payment by Nuvei transaction ID or session ID
    const payment = await Payment.findOne({
      $or: [
        { nuveiTransactionId: transactionId },
        { nuveiSessionId: data.sessionId || data.session_id }
      ]
    });

    if (!payment) {
      console.error(`❌ Payment not found for Nuvei transaction: ${transactionId}`);
      return;
    }

    // Update payment status and details
    payment.status = "succeeded";
    payment.succeededAt = new Date();
    payment.nuveiTransactionId = transactionId;
    
    // Update with any additional data from Nuvei
    if (data.amount) {
      payment.amount = Math.round(parseFloat(data.amount) * 100); // Convert to cents
    }
    if (data.currency) {
      payment.currency = data.currency.toLowerCase();
    }
    
    await payment.save();

    console.log(`✅ Nuvei payment succeeded for transaction: ${transactionId}`);
  } catch (error) {
    console.error(`❌ Error handling Nuvei payment success: ${error.message}`);
  }
};

// Handler for Nuvei payment failed event
const handleNuveiPaymentFailed = async (data, transactionId) => {
  try {
    // Find payment by Nuvei transaction ID or session ID
    const payment = await Payment.findOne({
      $or: [
        { nuveiTransactionId: transactionId },
        { nuveiSessionId: data.sessionId || data.session_id }
      ]
    });

    if (!payment) {
      console.error(`❌ Payment not found for failed Nuvei transaction: ${transactionId}`);
      return;
    }

    // Update payment status
    payment.status = "failed";
    if (data.failureReason || data.error) {
      payment.description = `${payment.description || ''} - Failed: ${data.failureReason || data.error}`;
    }
    
    await payment.save();

    console.log(`❌ Nuvei payment failed for transaction: ${transactionId}`);
  } catch (error) {
    console.error(`❌ Error handling Nuvei payment failure: ${error.message}`);
  }
};

// Handler for Nuvei refund completed event
const handleNuveiRefundCompleted = async (data, transactionId) => {
  try {
    // Find payment by Nuvei transaction ID
    const payment = await Payment.findOne({
      nuveiTransactionId: data.originalTransactionId || data.parentTransactionId
    });

    if (!payment) {
      console.error(`❌ Original payment not found for Nuvei refund: ${transactionId}`);
      return;
    }

    // Update payment status to refunded
    payment.status = "refunded";
    payment.stripeRefundId = transactionId; // Using existing field for refund ID
    
    await payment.save();

    // Find the associated contract and update its status
    if (payment.contract) {
      const contract = await Contract.findById(payment.contract);
      if (contract) {
        contract.status = "cancelled";
        await contract.save();
        console.log(`✅ Contract status updated to cancelled for refund: ${transactionId}`);
      }
    }

    console.log(`✅ Nuvei refund completed for transaction: ${transactionId}`);
  } catch (error) {
    console.error(`❌ Error handling Nuvei refund: ${error.message}`);
  }
};

// Nuvei Demo Response Handler (handles the response from demo_process_request)
export const nuveiDemoResponse = catchAsync(async (req, res, next) => {
  console.log('Nuvei Demo Response received:', req.body);
  
  // Extract response parameters from Nuvei
  const {
    pp_resp_hash,
    pp_resp_code,
    pp_resp_status,
    pp_resp_msg,
    transaction_id,
    session_token,
    amount,
    currency,
    ...additionalData
  } = req.body;

  // Respond with a simple success page
  res.status(200).send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Nuvei Payment Response</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 40px; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; }
            .success { color: green; }
            .error { color: red; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>Nuvei Payment Response</h1>
            <p>Payment Response Received</p>
            <p><strong>Transaction ID:</strong> ${transaction_id || 'N/A'}</p>
            <p><strong>Session Token:</strong> ${session_token || 'N/A'}</p>
            <p><strong>Amount:</strong> ${amount || 'N/A'} ${currency || 'N/A'}</p>
            <p><strong>Status:</strong> ${pp_resp_status || 'N/A'}</p>
            <p><strong>Message:</strong> ${pp_resp_msg || 'N/A'}</p>
            
            <form method="post" action="/api/v1/payments/nuvei/confirm-payment">
                <input type="hidden" name="sessionId" value="${session_token || ''}">
                <input type="hidden" name="nuveiTransactionId" value="${transaction_id || ''}">
                <button type="submit">Confirm Payment in System</button>
            </form>
        </div>
    </body>
    </html>
  `);
});

// Nuvei Default Cancel Handler (handles payment cancellations)
export const nuveiDefaultCancel = catchAsync(async (req, res, next) => {
  console.log('Nuvei Payment Cancelled:', req.body);
  
  // Log the cancellation
  const transactionId = req.body.transaction_id || req.body.session_token || 'Unknown';
  
  // You could update the payment status to 'cancelled' here if needed
  
  // Respond with a cancellation page
  res.status(200).send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Payment Cancelled</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 40px; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>Payment Cancelled</h1>
            <p>Your payment has been cancelled.</p>
            <p><strong>Transaction ID:</strong> ${transactionId}</p>
            <p>If this was a mistake, please try the payment again.</p>
            <a href="/">Return to Home</a>
        </div>
    </body>
    </html>
  `);
});

// --- Nuvei Onboarding Controller Functions ---

// Start Nuvei onboarding process
export const startNuveiOnboarding = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  
  try {
    // Start Nuvei onboarding process through the service
    const result = await nuveiPaymentService.startNuveiOnboarding(userId);
    
    res.status(200).json({
      status: "success",
      data: result
    });
  } catch (error) {
    console.error('Error starting Nuvei onboarding:', error);
    return next(new AppError(`Failed to start Nuvei onboarding: ${error.message}`, 500));
  }
});

// Check Nuvei onboarding status
export const checkNuveiOnboardingStatus = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  
  try {
    // Check Nuvei onboarding status through the service
    const result = await nuveiPaymentService.checkNuveiOnboardingStatus(userId);
    
    res.status(200).json({
      status: "success",
      data: result
    });
  } catch (error) {
    console.error('Error checking Nuvei onboarding status:', error);
    return next(new AppError(`Failed to check Nuvei onboarding status: ${error.message}`, 500));
  }
});

// Set default payment method
export const setDefaultPaymentMethod = catchAsync(async (req, res, next) => {
  const { defaultPaymentMethod } = req.body;
  const userId = req.user.id;
  
  // Validate payment method
  if (!['stripe', 'nuvei'].includes(defaultPaymentMethod)) {
    return next(new AppError("Invalid payment method. Use 'stripe' or 'nuvei'.", 400));
  }
  
  try {
    // Set default payment method through the service
    const result = await nuveiPaymentService.setDefaultPaymentMethod(userId, defaultPaymentMethod);
    
    res.status(200).json({
      status: "success",
      data: result
    });
  } catch (error) {
    console.error('Error setting default payment method:', error);
    return next(new AppError(`Failed to set default payment method: ${error.message}`, 500));
  }
});

// Get all payment methods for user
export const getUserPaymentMethods = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  
  try {
    // Get all payment methods through the service
    const result = await nuveiPaymentService.getUserPaymentMethods(userId);
    
    res.status(200).json({
      status: "success",
      data: result
    });
  } catch (error) {
    console.error('Error getting user payment methods:', error);
    return next(new AppError(`Failed to get payment methods: ${error.message}`, 500));
  }
});

// --- Nuvei Simply Connect Payment Handlers ---

// Create a Simply Connect payment session for contracts
export const createNuveiSimplyConnectSession = catchAsync(async (req, res, next) => {
  const providerId = req.user.id;
  const { contractId, amount, currency = 'USD' } = req.body;

  try {
    // Validate contract exists and belongs to provider
    const contract = await Contract.findById(contractId).populate('gig provider tasker');
    
    if (!contract) {
      return next(new AppError('Contract not found', 404));
    }
    
    if (contract.provider.toString() !== providerId) {
      return next(new AppError('Not authorized to pay for this contract', 403));
    }
    
    if (contract.status !== 'pending_payment') {
      return next(new AppError('Contract is not in pending payment status', 400));
    }

    // Generate a unique client request ID
    const clientRequestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // In a real implementation, you would call Nuvei's API to create a session
    // For now, we'll create a mock session with the required data
    
    // Mock session data - in real implementation, this would come from Nuvei API
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Mock response data - in real implementation, this would come from Nuvei API
    const mockResponse = {
      sessionId,
      clientRequestId,
      merchantId: process.env.NUVEI_MERCHANT_ID || 'mock_merchant_id',
      merchantSiteId: process.env.NUVEI_MERCHANT_SITE_ID || 'mock_site_id',
      currency,
      amount,
      contractId,
      providerId,
      returnUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/contracts?nuvei_response=1`,
      webhookUrl: `${process.env.BACKEND_URL || 'http://localhost:5000'}/api/v1/payments/webhook/nuvei`,
      transactionType: 'Auth',
      paymentMethod: 'CC',
      // Add any other required fields for Simply Connect
    };

    // Log the session creation for debugging
    logger.info('Nuvei Simply Connect session created', {
      sessionId,
      contractId,
      amount,
      currency,
      providerId
    });

    res.status(200).json({
      status: "success",
      data: mockResponse,
    });
  } catch (error) {
    logger.error('Error creating Nuvei Simply Connect session:', error);
    return next(new AppError(`Failed to create Nuvei Simply Connect session: ${error.message}`, 500));
  }
});

// Confirm Simply Connect payment completion
export const confirmNuveiSimplyConnectPayment = catchAsync(async (req, res, next) => {
  const providerId = req.user.id;
  const { contractId, transactionId, paymentResult } = req.body;

  try {
    // Validate contract exists and belongs to provider
    const contract = await Contract.findById(contractId);
    
    if (!contract) {
      return next(new AppError('Contract not found', 404));
    }
    
    if (contract.provider.toString() !== providerId) {
      return next(new AppError('Not authorized to confirm payment for this contract', 403));
    }

    // In a real implementation, you would:
    // 1. Verify the payment with Nuvei's API
    // 2. Update the contract status
    // 3. Create a payment record
    // 4. Handle any errors or fraud detection
    
    // For now, we'll simulate successful payment processing
    
    // Update contract status to completed
    contract.status = 'completed';
    contract.completedAt = new Date();
    await contract.save();

    // Create a payment record
    const nuveiPayment = await NuveiPayment.create({
      contract: contractId,
      provider: providerId,
      tasker: contract.tasker,
      amount: contract.agreedCost,
      currency: 'USD',
      status: 'succeeded',
      transactionId: transactionId,
      sessionId: paymentResult?.SessionId || `session_${transactionId}`,
      paymentMethod: paymentResult?.PaymentMethod || 'CC',
      gatewayResponse: paymentResult,
      processedAt: new Date(),
    });

    // Log the successful payment
    logger.info('Nuvei Simply Connect payment confirmed', {
      transactionId,
      contractId,
      amount: contract.agreedCost,
      providerId
    });

    res.status(200).json({
      status: "success",
      data: {
        message: 'Payment confirmed successfully',
        payment: nuveiPayment,
        contract: {
          id: contract._id,
          status: contract.status
        }
      },
    });
  } catch (error) {
    logger.error('Error confirming Nuvei Simply Connect payment:', error);
    return next(new AppError(`Failed to confirm Nuvei Simply Connect payment: ${error.message}`, 500));
  }
});