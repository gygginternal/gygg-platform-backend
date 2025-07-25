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
import { 
  logPaymentEvent, 
  logWebhookEvent, 
  logError, 
  logSuspiciousActivity,
  SECURITY_EVENTS 
} from '../utils/securityLogger.js';

// Initialize Stripe with the secret key from environment variables
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

export const getPayments = catchAsync(async (req, res, next) => {
  const { status, payer, payee, page = 1, limit = 10 } = req.query;
  
  // Security: Validate and sanitize input parameters
  const pageNumber = Math.max(1, parseInt(page, 10) || 1);
  const pageLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 10)); // Max 100 per page
  
  // Security: Only allow users to see their own payments unless admin
  const userId = req.user.id;
  const isAdmin = req.user.role.includes('admin');
  
  if (!isAdmin && payer && payer !== userId && payee && payee !== userId) {
    return next(new AppError('You can only view your own payments', 403));
  }

  // Build the query object with security constraints
  const query = {};

  query.status = "succeeded"; // Filter by payment status

  // Security: Restrict query based on user role
  if (!isAdmin) {
    query.$or = [
      { payer: userId },
      { payee: userId }
    ];
  } else {
    // Admin can filter by specific payer/payee
    if (payer) {
      query.payer = payer;
    }
    if (payee) {
      query.payee = payee;
    }
  }

  const skip = (pageNumber - 1) * pageLimit;

  // Fetch payments based on the query with pagination
  const payments = await Payment.find(query)
    .populate("contract", "title") // Populate contract details
    .populate("payer", "firstName lastName email") // Populate payer details
    .populate("payee", "firstName lastName email") // Populate payee details
    .skip(skip)
    .limit(pageLimit)
    .lean(); // Use lean for better performance

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
    
    // Security: Log payment access
    logPaymentEvent(SECURITY_EVENTS.DATA_ACCESS, payment?._id, req.user.id, payment?.amount, {
      action: 'payment_intent_retrieved',
      contractId
    });

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
    logError(error, {
      action: 'release_payment_failed',
      contractId,
      providerId,
      paymentId: payment._id
    });
    
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
    const amountInCents = Math.round(contract.agreedCost * 100); // Total amount provider pays
    if (amountInCents <= 0)
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

    // 3. Calculate platform fee (still on pre-tax amount)
    const feePercentage = parseFloat(process.env.PLATFORM_FEE_PERCENT) || 0;
    const fixedFeeCents = 500; // $5.00 in cents
    const percentageFee = Math.round(amountInCents * (feePercentage / 100));
    const applicationFeeAmount = percentageFee + fixedFeeCents;

    // 4. Update payment record (taxAmount and amountAfterTax will be set after payment)
    let payment = await Payment.findOne({ contract: contractId });
    if (!payment) {
      payment = await Payment.create({
        contract: contractId,
        gig: contract.gig,
        payer: providerId,
        payee: contract.tasker._id,
        amount: amountInCents,
        currency: 'cad',
        status: "requires_payment_method",
        stripeConnectedAccountId: taskerStripeAccountId,
        applicationFeeAmount: applicationFeeAmount,
        amountReceivedByPayee: 0, // Set to 0, will update after payment
        taxAmount: 0, // Set to 0, will update after payment
        amountAfterTax: 0, // Set to 0, will update after payment
      });
    } else if (!["requires_payment_method", "failed"].includes(payment.status)) {
      return next(new AppError(`Payment already in status: ${payment.status}`, 400));
    } else {
      payment.amount = amountInCents;
      payment.currency = 'cad';
      payment.stripeConnectedAccountId = taskerStripeAccountId;
      payment.applicationFeeAmount = applicationFeeAmount;
      payment.amountReceivedByPayee = 0;
      payment.taxAmount = 0;
      payment.amountAfterTax = 0;
      payment.status = "requires_payment_method";
      await payment.save();
    }

    // 5. Create PaymentIntent with Stripe Tax enabled
    const paymentIntentParams = {
      amount: amountInCents,
      currency: payment.currency,
      automatic_payment_methods: { enabled: true },
      capture_method: "manual",
      application_fee_amount: payment.applicationFeeAmount,
      transfer_data: { destination: taskerStripeAccountId },
      customer: stripeCustomerId,
      metadata: {
        paymentId: payment._id.toString(),
        contractId: contractId.toString(),
        providerId: providerId.toString(),
        taskerId: contract.tasker._id.toString(),
      },
    };

    // Add automatic tax only if customer has address information
    if (provider.address && provider.address.country) {
      paymentIntentParams.automatic_tax = { enabled: true };
    } else {
      logger.info("Automatic tax disabled: Customer address not available", {
        providerId,
        contractId
      });
    }

    let paymentIntent;
    if (payment.stripePaymentIntentId) {
      try {
        paymentIntent = await stripe.paymentIntents.update(
          payment.stripePaymentIntentId,
          paymentIntentParams
        );
      } catch (error) {
        if (
          error.code === "payment_intent_unexpected_state" ||
          error.code === "resource_missing"
        ) {
          // Try creating new PaymentIntent, with fallback for automatic_tax
          try {
            paymentIntent = await stripe.paymentIntents.create(paymentIntentParams);
          } catch (createError) {
            if (createError.message && createError.message.includes('automatic_tax')) {
              logger.info("Automatic tax not supported, creating PaymentIntent without it", {
                providerId,
                contractId
              });
              const { automatic_tax, ...paramsWithoutTax } = paymentIntentParams;
              paymentIntent = await stripe.paymentIntents.create(paramsWithoutTax);
            } else {
              throw createError;
            }
          }
          payment.stripePaymentIntentId = paymentIntent.id;
        } else if (error.message && error.message.includes('automatic_tax')) {
          logger.info("Automatic tax not supported, updating PaymentIntent without it", {
            providerId,
            contractId
          });
          const { automatic_tax, ...paramsWithoutTax } = paymentIntentParams;
          paymentIntent = await stripe.paymentIntents.update(
            payment.stripePaymentIntentId,
            paramsWithoutTax
          );
        } else {
          logError(error, {
            action: 'stripe_payment_intent_update_failed',
            providerId,
            contractId,
            paymentIntentId: payment.stripePaymentIntentId
          });
          throw error;
        }
      }
    } else {
      try {
        paymentIntent = await stripe.paymentIntents.create(paymentIntentParams);
        payment.stripePaymentIntentId = paymentIntent.id;
        payment.stripePaymentIntentSecret = paymentIntent.client_secret;
      } catch (error) {
        if (error.message && error.message.includes('automatic_tax')) {
          logger.info("Automatic tax not supported, creating PaymentIntent without it", {
            providerId,
            contractId
          });
          const { automatic_tax, ...paramsWithoutTax } = paymentIntentParams;
          paymentIntent = await stripe.paymentIntents.create(paramsWithoutTax);
          payment.stripePaymentIntentId = paymentIntent.id;
          payment.stripePaymentIntentSecret = paymentIntent.client_secret;
        } else {
          logError(error, {
            action: 'stripe_payment_intent_creation_failed',
            providerId,
            contractId
          });
          throw error;
        }
      }
    }

    payment.status = "requires_payment_method";
    await payment.save();

    // Log payment creation
    logPaymentEvent(SECURITY_EVENTS.PAYMENT_CREATED, payment._id, providerId, payment.amount, {
      contractId,
      taskerId: contract.tasker._id.toString(),
      applicationFeeAmount: payment.applicationFeeAmount
    });

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
      logError(new Error('Payment record not found for payout'), {
        payoutId,
        event: 'payout.paid'
      });
      return;
    }

    // Update the payment status to "succeeded"
    payment.status = "succeeded";
    await payment.save();

    logPaymentEvent(SECURITY_EVENTS.PAYMENT_CREATED, payment._id, payment.payee, payment.amount, {
      event: 'payout_paid',
      payoutId
    });
  } catch (error) {
    logError(error, {
      event: 'payout.paid',
      payoutId: dataObject.id
    });
  }
};

const handleChargeRefunded = async (dataObject) => {
  try {
    const charge = dataObject;

    // Retrieve the PaymentIntent ID from the charge
    const paymentIntentId = charge.payment_intent;

    if (!paymentIntentId) {
      logger.info("No PaymentIntent associated with this charge", {
        chargeId: charge.id
      });
      return;
    }

    // Fetch the PaymentIntent from Stripe
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    // Find the payment record in the database
    const payment = await Payment.findOne({
      stripePaymentIntentId: paymentIntentId,
    });

    if (!payment) {
      logError(new Error('Payment record not found for refund'), {
        paymentIntentId,
        event: 'charge.refunded'
      });
      return;
    }

    // Update the payment status to "refunded"
    payment.status = "refunded";
    await payment.save();

    logPaymentEvent(SECURITY_EVENTS.PAYMENT_REFUNDED, payment._id, payment.payer, payment.amount, {
      paymentIntentId,
      event: 'charge_refunded'
    });

    // Find the associated contract and gig
    const contract = await Contract.findById(payment.contract);
    const gig = await Gig.findById(payment.gig);

    if (contract) {
      // Update the contract status to "cancelled"
      contract.status = "cancelled";
      await contract.save();
      
      logger.info('Contract cancelled due to refund', {
        contractId: contract._id,
        paymentIntentId
      });
    }

    if (gig) {
      // Update the gig status to "cancelled"
      gig.status = "cancelled";
      await gig.save();
      
      logger.info('Gig cancelled due to refund', {
        gigId: gig._id,
        paymentIntentId
      });
    }
  } catch (error) {
    logError(error, {
      event: 'charge.refunded',
      chargeId: dataObject.id
    });
  }
};

// --- Stripe Webhook Handler ---
export const stripeWebhookHandler = async (req, res) => {
  const sig = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    
    logWebhookEvent(event.type, true, {
      eventId: event.id,
      created: event.created
    });
  } catch (err) {
    logWebhookEvent('unknown', false, {
      error: err.message,
      signature: sig ? 'present' : 'missing'
    });
    
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

// Add new handler for payment_intent.succeeded
const handlePaymentIntentSucceeded = async (paymentIntent) => {
  try {
    const payment = await Payment.findOne({
      stripePaymentIntentId: paymentIntent.id,
    });

    if (!payment) {
      logError(new Error('Payment not found for PaymentIntent'), {
        paymentIntentId: paymentIntent.id,
        event: 'payment_intent.succeeded'
      });
      return;
    }

    // Extract Stripe Tax and payout info if available
    let taxAmount = 0;
    let amountAfterTax = 0;
    let amountReceivedByPayee = 0;
    if (paymentIntent.automatic_tax && paymentIntent.automatic_tax.amount_collectable != null) {
      taxAmount = paymentIntent.automatic_tax.amount_collectable;
    }
    // Stripe's PaymentIntent has 'amount' (total), 'amount_received', and 'application_fee_amount'
    // amountAfterTax = amount - taxAmount
    amountAfterTax = paymentIntent.amount - taxAmount;
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

    logPaymentEvent(SECURITY_EVENTS.PAYMENT_CREATED, payment._id, payment.payee, payment.amount, {
      event: 'payment_intent_succeeded',
      paymentIntentId: paymentIntent.id
    });
  } catch (error) {
    logError(error, {
      event: 'payment_intent.succeeded',
      paymentIntentId: paymentIntent.id
    });
  }
};

// Add new handler for payment_intent.canceled
const handlePaymentIntentCanceled = async (paymentIntent) => {
  try {
    const payment = await Payment.findOne({
      stripePaymentIntentId: paymentIntent.id,
    });

    if (!payment) {
      logError(new Error('Payment not found for PaymentIntent'), {
        paymentIntentId: paymentIntent.id,
        event: 'payment_intent.canceled'
      });
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

    logger.info('Payment canceled', {
      paymentId: payment._id,
      paymentIntentId: paymentIntent.id
    });
  } catch (error) {
    logError(error, {
      event: 'payment_intent.canceled',
      paymentIntentId: paymentIntent.id
    });
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
    logPaymentEvent(SECURITY_EVENTS.PAYMENT_REFUNDED, payment._id, req.user.id, payment.amount, {
      refundId: refund.id,
      refundStatus: refund.status,
      contractId
    });

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
    logError(error, {
      action: 'stripe_refund_creation_failed',
      contractId,
      paymentId: payment._id,
      chargeId
    });
    
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
    logError(error, {
      action: 'stripe_account_creation_failed',
      userId: req.user.id,
      email: user.email
    });
    
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
    logError(error, {
      action: 'stripe_account_link_creation_failed',
      userId: user._id,
      stripeAccountId: user.stripeAccountId
    });
    
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
    logError(error, {
      action: 'stripe_account_retrieval_failed',
      userId: user._id,
      stripeAccountId: user.stripeAccountId
    });
    
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
      paymentId: payment._id,
      date: payment.createdAt ? payment.createdAt.toISOString().slice(0, 10) : '',
      gigTitle: payment.gig?.title || '',
      contractId: payment.contract?._id || '',
      providerFirstName: payment.payer.firstName,
      providerLastName: payment.payer.lastName,
      providerEmail: payment.payer.email,
      taskerFirstName: payment.payee.firstName,
      taskerLastName: payment.payee.lastName,
      taskerEmail: payment.payee.email,
      amount: (payment.amount / 100).toFixed(2),
      currency: payment.currency || 'USD',
      platformFee: (payment.applicationFeeAmount / 100).toFixed(2),
      tax: (payment.taxAmount / 100).toFixed(2),
      payout: (payment.amountAfterTax / 100).toFixed(2),
    }, res);
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
