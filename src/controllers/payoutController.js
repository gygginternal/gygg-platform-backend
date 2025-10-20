import catchAsync from '../utils/catchAsync.js';
import AppError from '../utils/AppError.js';
import stripePayoutService from '../services/payment/StripePayoutService.js';
import nuveiPayoutService from '../services/payment/NuveiPayoutService.js';
import User from '../models/User.js';
import logger from '../utils/logger.js';

// --- Process Withdrawal Request (Independent Payout Flows) ---
export const processWithdrawal = catchAsync(async (req, res, next) => {
  const { amount, paymentMethod = 'stripe' } = req.body; // Added paymentMethod parameter
  const userId = req.user.id;

  // Validate amount
  if (!amount || amount <= 0) {
    return next(new AppError("Valid withdrawal amount (minimum $0.01) is required.", 400));
  }

  if (!['stripe', 'nuvei'].includes(paymentMethod)) {
    return next(new AppError("Invalid payment method. Use 'stripe' or 'nuvei'.", 400));
  }

  try {
    let result;
    
    if (paymentMethod === 'stripe') {
      // Process withdrawal via Stripe (independent payout flow)
      result = await stripePayoutService.processStripeWithdrawal(userId, amount);
    } else if (paymentMethod === 'nuvei') {
      // Process withdrawal via Nuvei (independent payout flow)
      result = await nuveiPayoutService.processNuveiWithdrawal(userId, amount);
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

// --- Get User's Stripe Withdrawal History ---
export const getStripeWithdrawalHistory = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const { page = 1, limit = 10 } = req.query;

  try {
    const result = await stripePayoutService.getUserStripeWithdrawals(userId, parseInt(page), parseInt(limit));

    res.status(200).json({
      status: "success",
      data: result,
    });
  } catch (error) {
    logger.error('Error getting Stripe withdrawal history:', error);
    return next(new AppError(`Failed to get Stripe withdrawal history: ${error.message}`, 500));
  }
});

// --- Get User's Nuvei Withdrawal History ---
export const getNuveiWithdrawalHistory = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const { page = 1, limit = 10 } = req.query;

  try {
    const result = await nuveiPayoutService.getUserNuveiWithdrawals(userId, parseInt(page), parseInt(limit));

    res.status(200).json({
      status: "success",
      data: result,
    });
  } catch (error) {
    logger.error('Error getting Nuvei withdrawal history:', error);
    return next(new AppError(`Failed to get Nuvei withdrawal history: ${error.message}`, 500));
  }
});

// --- Get User's Available Balance by Payment Method ---
export const getPaymentMethodBalance = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const { paymentMethod = 'both' } = req.query; // 'stripe', 'nuvei', or 'both'

  try {
    const balances = {};

    if (paymentMethod === 'both' || paymentMethod === 'stripe') {
      const stripeBalance = await stripePayoutService.getStripeAvailableBalance(userId);
      balances.stripe = {
        available: stripeBalance / 100, // Convert from cents to dollars
        availableFormatted: (stripeBalance / 100).toFixed(2),
        currency: 'USD',
        paymentProvider: 'stripe'
      };
    }

    if (paymentMethod === 'both' || paymentMethod === 'nuvei') {
      const nuveiBalance = await nuveiPayoutService.getNuveiAvailableBalance(userId);
      balances.nuvei = {
        available: nuveiBalance / 100, // Convert from cents to dollars
        availableFormatted: (nuveiBalance / 100).toFixed(2),
        currency: 'CAD',
        paymentProvider: 'nuvei'
      };
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

// --- Set Default Payment Method ---
export const setDefaultPaymentMethod = catchAsync(async (req, res, next) => {
  const { defaultPaymentMethod } = req.body;
  const userId = req.user.id;

  // Validate payment method
  if (!['stripe', 'nuvei'].includes(defaultPaymentMethod)) {
    return next(new AppError("Invalid payment method. Use 'stripe' or 'nuvei'.", 400));
  }

  try {
    // Set default payment method for the user
    const user = await User.findByIdAndUpdate(
      userId,
      { defaultPaymentMethod },
      { new: true, runValidators: true }
    );

    if (!user) {
      return next(new AppError('User not found', 404));
    }

    res.status(200).json({
      status: "success",
      data: {
        defaultPaymentMethod: user.defaultPaymentMethod,
        message: `Default payment method set to ${defaultPaymentMethod}`
      }
    });
  } catch (error) {
    logger.error('Error setting default payment method:', error);
    return next(new AppError(`Failed to set default payment method: ${error.message}`, 500));
  }
});

// --- Get User Payment Methods ---
export const getUserPaymentMethods = catchAsync(async (req, res, next) => {
  const userId = req.user.id;

  try {
    const user = await User.findById(userId).select(
      "+stripeAccountId +nuveiAccountId +nuveiCustomerId +nuveiVerificationStatus +nuveiBankToken +nuveiPaymentMethods +nuveiBankTransferEnabled +nuveiBankDetails"
    );
    
    if (!user) {
      return next(new AppError('User not found', 404));
    }

    const methods = {
      stripe: {
        connected: !!user.stripeAccountId,
        accountId: user.stripeAccountId,
        chargesEnabled: user.stripeChargesEnabled,
        payoutsEnabled: user.stripePayoutsEnabled,
        customerId: user.stripeCustomerId,
        default: user.defaultPaymentMethod === 'stripe'
      },
      nuvei: {
        connected: !!user.nuveiAccountId,
        accountId: user.nuveiAccountId,
        customerId: user.nuveiCustomerId,
        verificationStatus: user.nuveiVerificationStatus,
        bankToken: user.nuveiBankToken,
        paymentMethods: user.nuveiPaymentMethods,
        bankTransferEnabled: user.nuveiBankTransferEnabled,
        bankDetails: user.nuveiBankDetails,
        default: user.defaultPaymentMethod === 'nuvei'
      },
      defaultMethod: user.defaultPaymentMethod || 'stripe'
    };

    res.status(200).json({
      status: "success",
      data: {
        methods,
        message: "Payment methods retrieved successfully"
      }
    });
  } catch (error) {
    logger.error('Error getting user payment methods:', error);
    return next(new AppError(`Failed to get payment methods: ${error.message}`, 500));
  }
});