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
import PaymentGatewayFactory from '../services/paymentGateways/PaymentGatewayFactory.js';

// Export the factory for use in other modules
export { PaymentGatewayFactory };

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

    // Create gateway instance based on payment gateway type
    const gateway = PaymentGatewayFactory.createGateway(payment.paymentGateway);
    
    // Check if the payment status is valid for release
    const isPayoutReady = payment.status === "succeeded";

    // Retrieve the available balance from the payment gateway
    const balance = await gateway.getBalance(payment.providerAccountId);

    // For simplicity, we're assuming USD currency here
    // In a real implementation, you'd need to handle different currencies
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

// --- Create Payment Intent for Contract (Provider -> Tasker via Platform) ---
export const createPaymentIntentForContract = catchAsync(
  async (req, res, next) => {
    const { contractId } = req.params;
    const providerId = req.user.id;
    // Get the preferred payment gateway from request or use default
    const paymentGateway = req.body.paymentGateway || 'stripe';

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

    // Ensure that the provider has connected their payment account
    const provider = await User.findById(providerId);
    if (!provider.providerAccountId)
      return next(new AppError("Provider must connect their payment account before making payments.", 400));

    // Ensure that the contract is in a valid status for payment
    if (!["active", "submitted", "failed"].includes(contract.status)) {
      return next(
        new AppError(
          `Contract not awaiting payment (status: ${contract.status}).`,
          400
        )
      );
    }

    // Ensure that the tasker has connected a valid payment account
    if (!contract.tasker?.providerAccountId)
      return next(new AppError("Tasker has not connected a payment account.", 400));

    const taskerAccountId = contract.tasker.providerAccountId;

    // Validate that the account actually exists (gateway-specific)
    try {
      const gateway = PaymentGatewayFactory.createGateway(paymentGateway);
      await gateway.getAccountStatus(taskerAccountId);
    } catch (error) {
      // This is a simplified error handling - in reality, you'd want to check
      // if the error indicates an invalid account and clear it from the user
      console.error('Account validation error:', error);
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

    // Create/update payment record
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
        providerAccountId: taskerAccountId,
        paymentGateway: paymentGateway,
        paymentMethodType: paymentGateway, // For backward compatibility
      });
    } else if (!["requires_payment_method", "failed"].includes(payment.status)) {
      return next(new AppError(`Payment already in status: ${payment.status}`, 400));
    } else {
      payment.amount = serviceAmountInCents;
      payment.status = "requires_payment_method";
      payment.paymentGateway = paymentGateway;
      payment.paymentMethodType = paymentGateway;
      await payment.save();
    }

    // Get the total amount provider needs to pay (after pre-save hook calculations)
    const totalProviderPaymentAmount = payment.totalProviderPayment || payment.amount;

    // Create gateway instance
    const gateway = PaymentGatewayFactory.createGateway(paymentGateway);
    
    // Create PaymentIntent with gateway-specific parameters
    const paymentIntentParams = {
      amount: totalProviderPaymentAmount,
      currency: payment.currency,
      metadata: {
        paymentId: payment._id.toString(),
        contractId: contractId.toString(),
        providerId: providerId.toString(),
        taskerId: contract.tasker._id.toString(),
      },
    };

    // For development/testing, always create a new PaymentIntent to avoid conflicts
    // In production, you might want to reuse PaymentIntents for better UX
    const paymentIntent = await gateway.createPaymentIntent(paymentIntentParams);
    
    payment.paymentIntentId = paymentIntent.id;
    // For Stripe, we would store the client_secret, but for other gateways
    // we might store a different identifier or URL
    if (paymentIntent.clientSecret) {
      payment.gatewayMetadata = payment.gatewayMetadata || new Map();
      payment.gatewayMetadata.set('clientSecret', paymentIntent.clientSecret);
    }
    
    payment.status = "requires_payment_method";
    await payment.save();

    res.status(200).json({
      status: "success",
      // For Stripe compatibility, we still return clientSecret
      // For other gateways, we might return a different field
      clientSecret: paymentIntent.clientSecret || paymentIntent.approvalUrl,
      paymentId: payment._id,
      gateway: paymentGateway,
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
    // Create gateway instance
    const gateway = PaymentGatewayFactory.createGateway(payment.paymentGateway);
    
    // Capture the payment
    const captureResult = await gateway.capturePayment(payment.paymentIntentId);

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
      captureResult,
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

// Handler for payment success confirmation
const handlePaymentSuccess = async (paymentIntent) => {
  try {
    const payment = await Payment.findOne({
      paymentIntentId: paymentIntent.id,
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
    console.error(`❌ Error handling payment success: ${error.message}`);
  }
};

// --- Stripe Webhook Handler (kept for backward compatibility) ---
export const stripeWebhookHandler = async (req, res) => {
  // This handler would need to be updated to work with the new abstraction
  // For now, we'll keep it as is but note that it's Stripe-specific
  res.status(200).json({ received: true });
};

// Endpoint to confirm payment success from frontend
export const confirmPaymentSuccess = catchAsync(async (req, res, next) => {
  const { paymentIntentId, gateway } = req.body;

  if (!paymentIntentId) {
    return next(new AppError('Payment Intent ID is required', 400));
  }

  try {
    // Create gateway instance
    const paymentGateway = PaymentGatewayFactory.createGateway(gateway || 'stripe');
    
    // Verify the payment intent with the gateway
    const paymentIntent = await paymentGateway.getPaymentStatus(paymentIntentId);

    if (paymentIntent.status !== 'succeeded') {
      return next(new AppError('Payment has not succeeded yet', 400));
    }

    // Find the payment record
    const payment = await Payment.findOne({
      paymentIntentId: paymentIntentId,
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

// --- Initiate Refund for Contract ---
export const refundPaymentForContract = catchAsync(async (req, res, next) => {
  const { contractId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(contractId))
    return next(new AppError("Invalid Contract ID format.", 400));

  const contract = await Contract.findById(contractId);
  if (!contract) return next(new AppError("Contract not found", 404));

  const payment = await Payment.findOne({ contract: contractId });
  if (!payment) return next(new AppError("Payment record not found", 404));
  if (!payment.paymentIntentId)
    return next(new AppError("Cannot refund: Missing Payment Intent ID.", 500));

  try {
    // Create gateway instance
    const gateway = PaymentGatewayFactory.createGateway(payment.paymentGateway);
    
    // Initiate the refund via the payment gateway
    const refund = await gateway.refundPayment(
      payment.paymentIntentId,
      payment.amount // Full refund by default, can be customized
    );
    
    console.log(
      `Gateway Refund created: ${refund.id}, Status: ${refund.status}`
    );

    // Update payment and contract status
    payment.status = refund.status === "succeeded" ? "canceled" : "canceling";
    payment.refundId = refund.id;
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
      `❌ Error creating refund:`, error
    );
    return next(
      new AppError(`Failed to initiate refund: ${error.message}.`, 500)
    );
  }
});

// --- Create Connected Account for User ---
export const createConnectedAccount = catchAsync(async (req, res, next) => {
  const { paymentGateway } = req.body; // Accept gateway type from request
  const user = await User.findById(req.user.id);
  if (!user) return next(new AppError("User not found.", 404));

  // If user already has a provider account ID, proceed to create the account link
  if (user.providerAccountId) {
    return createAccountLink(req, res, next);
  }

  try {
    // Create gateway instance
    const gateway = PaymentGatewayFactory.createGateway(paymentGateway || 'stripe');
    
    // Create a new account with the payment gateway
    const accountData = {
      email: user.email,
      country: 'CA', // Default, could be customized
      // Add other user-specific data as needed
    };
    
    const account = await gateway.createAccount(accountData);

    user.providerAccountId = account.id;
    user.paymentGateway = paymentGateway || 'stripe';
    await user.save({ validateBeforeSave: false });
    
    return createAccountLink(req, res, next);
  } catch (error) {
    console.error("Error creating payment account:", error);
    return next(new AppError("Could not create payment account.", 500));
  }
});

// --- Generate Account Link for Onboarding ---
export const createAccountLink = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user.id).select("+providerAccountId +paymentGateway");

  if (!user || !user.providerAccountId) {
    // If no account exists, create one first
    return createConnectedAccount(req, res, next);
  }

  try {
    // For Stripe, we would create an account link
    // For PayPal, we might redirect to their onboarding
    // For other gateways, the approach would vary
    
    // This is a simplified implementation - in reality, each gateway
    // would have its own way of handling account onboarding
    
    res.status(200).json({ 
      status: "success", 
      message: "Account link would be generated here based on the payment gateway",
      accountId: user.providerAccountId,
      gateway: user.paymentGateway
    });
  } catch (error) {
    console.error(
      `Error creating Account Link for ${user.providerAccountId}:`,
      error
    );
    return next(new AppError("Could not create onboarding link.", 500));
  }
});

// --- Get Account Status ---
export const getAccountStatus = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user.id).select("+providerAccountId +paymentGateway");
  if (!user || !user.providerAccountId) {
    // Return a response indicating no account exists
    return res.status(200).json({
      status: "success",
      account: null,
      payoutsEnabled: false,
      detailsSubmitted: false,
      chargesEnabled: false,
      accountStatus: "not_connected",
      message: "No payment account connected"
    });
  }

  try {
    // Create gateway instance
    const gateway = PaymentGatewayFactory.createGateway(user.paymentGateway);
    
    const account = await gateway.getAccountStatus(user.providerAccountId);
    
    res.status(200).json({
      account,
      status: "success",
      payoutsEnabled: account.payoutsEnabled,
      detailsSubmitted: account.detailsSubmitted,
      chargesEnabled: account.chargesEnabled,
      accountStatus: account.chargesEnabled && account.payoutsEnabled ? "active" : "incomplete",
    });
  } catch (error) {
    console.error(
      `Error retrieving account ${user.providerAccountId}:`,
      error
    );
    return next(new AppError("Could not retrieve account status.", 500));
  }
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

// --- Get Available Balance for Withdrawal ---
export const getBalance = catchAsync(async (req, res, next) => {
  const userId = req.user.id;

  // Get user with provider account ID
  const user = await User.findById(userId).select("+providerAccountId +paymentGateway");
  if (!user || !user.providerAccountId) {
    return next(new AppError("Payment account not connected. Please complete onboarding first.", 400));
  }

  try {
    // Create gateway instance
    const gateway = PaymentGatewayFactory.createGateway(user.paymentGateway);
    
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
      // In production mode, get real balance from the payment gateway
      const balance = await gateway.getBalance(user.providerAccountId);

      // This is simplified - in reality, you'd need to handle different currencies
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
        accountId: user.providerAccountId,
      },
    });
  } catch (error) {
    logger.error(`Error retrieving balance for user ${userId}:`, error);
    return next(new AppError("Failed to retrieve balance from payment gateway.", 500));
  }
});

// --- Process Withdrawal Request ---
export const processWithdrawal = catchAsync(async (req, res, next) => {
  const { amount, paymentGateway } = req.body;
  const userId = req.user.id;

  // Validate amount
  if (!amount || amount <= 0) {
    return next(new AppError("Valid withdrawal amount is required.", 400));
  }

  // Get user with provider account ID
  const user = await User.findById(userId).select("+providerAccountId +paymentGateway");
  if (!user || !user.providerAccountId) {
    return next(new AppError("Payment account not connected. Please complete onboarding first.", 400));
  }

  // Use the gateway from request or user's default
  const gatewayType = paymentGateway || user.paymentGateway;
  
  let availableAmount = 0; // Move this outside the try block
  const requestedAmount = Math.round(amount * 100); // Convert to cents

  try {
    // Create gateway instance
    const gateway = PaymentGatewayFactory.createGateway(gatewayType);
    
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
      // In production mode, get real balance from the payment gateway
      const balance = await gateway.getBalance(user.providerAccountId);

      // This is simplified - in reality, you'd need to handle different currencies
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
      payoutId = `payout_dev_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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
      // Create real payout with the payment gateway
      payout = await gateway.createPayout({
        amount: requestedAmount,
        currency: 'usd',
        accountId: user.providerAccountId,
        // Add other payout details as needed
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
      payoutId: payoutId,
      description: `Withdrawal to bank account`,
      type: 'withdrawal',
      providerAccountId: user.providerAccountId,
      amountReceivedByPayee: requestedAmount,
      amountAfterTax: requestedAmount,
      applicationFeeAmount: 0,
      taxAmount: 0,
      paymentGateway: gatewayType, // Store the gateway used
      paymentMethodType: gatewayType, // For backward compatibility
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

    return next(new AppError(`Failed to process withdrawal request: ${error.message}`, 500));
  }
});