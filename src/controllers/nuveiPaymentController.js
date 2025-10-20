import NuveiPayment from '../models/NuveiPayment.js';
import Contract from '../models/Contract.js';
import User from '../models/User.js';
import AppError from '../utils/AppError.js';
import catchAsync from '../utils/catchAsync.js';
import logger from '../utils/logger.js';
import nuveiPaymentService from '../services/payment/NuveiPaymentService.js';
import mongoose from 'mongoose';

// --- Create Nuvei payment session for contract ---
export const createNuveiPaymentSessionForContract = catchAsync(async (req, res, next) => {
  const { contractId } = req.params;
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

// --- Get Nuvei payment session details ---
export const getNuveiPaymentSessionForContract = catchAsync(async (req, res, next) => {
  const { sessionId } = req.params;
  const userId = req.user.id;

  try {
    const result = await nuveiPaymentService.getPaymentBySessionId(sessionId);
    
    // Additional authorization check
    if (![result.payer._id.toString(), result.payee._id.toString()].includes(userId) && 
        !req.user.role.includes('admin')) {
      return next(new AppError("Not authorized to access this payment session.", 403));
    }

    res.status(200).json({
      status: "success",
      data: result,
    });
  } catch (error) {
    console.error('Error getting Nuvei payment session:', error);
    return next(new AppError(`Failed to get Nuvei payment session: ${error.message}`, 500));
  }
});

// --- Confirm Nuvei payment (after frontend completion) ---
export const confirmNuveiPaymentForContract = catchAsync(async (req, res, next) => {
  const { nuveiTransactionId, sessionId } = req.body;

  if (!nuveiTransactionId && !sessionId) {
    return next(new AppError('Nuvei transaction ID or session ID is required', 400));
  }

  try {
    const result = await nuveiPaymentService.confirmPayment(nuveiTransactionId, sessionId);
    
    res.status(200).json({
      status: "success",
      message: "Nuvei payment confirmed and contract updated",
      data: result,
    });
  } catch (error) {
    console.error('Error confirming Nuvei payment:', error);
    return next(new AppError(`Failed to confirm Nuvei payment: ${error.message}`, 500));
  }
});

// --- Verify Nuvei transaction ---
export const verifyNuveiTransaction = catchAsync(async (req, res, next) => {
  const { transactionId } = req.params;

  if (!transactionId) {
    return next(new AppError('Nuvei transaction ID is required', 400));
  }

  try {
    const result = await nuveiPaymentService.verifyTransaction(transactionId);
    
    res.status(200).json({
      status: "success",
      data: result,
    });
  } catch (error) {
    console.error('Error verifying Nuvei transaction:', error);
    return next(new AppError(`Failed to verify Nuvei transaction: ${error.message}`, 500));
  }
});

// --- Process Nuvei withdrawal ---
export const processNuveiWithdrawal = catchAsync(async (req, res, next) => {
  const { amount } = req.body;
  const userId = req.user.id;

  // Validate amount
  if (!amount || amount <= 0) {
    return next(new AppError("Valid withdrawal amount (minimum $0.01) is required.", 400));
  }

  try {
    const result = await nuveiPaymentService.processWithdrawal(userId, amount);
    
    if (!result.success) {
      return next(new AppError(result.error, 400));
    }

    res.status(200).json({
      status: "success",
      message: "Nuvei withdrawal request submitted successfully",
      data: result,
    });
  } catch (error) {
    console.error('Error processing Nuvei withdrawal:', error);
    return next(new AppError(`Failed to process Nuvei withdrawal: ${error.message}`, 500));
  }
});

// --- Get Nuvei payment history ---
export const getNuveiPaymentHistory = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const { type = 'all', status = 'all', page = 1, limit = 10 } = req.query;

  try {
    const result = await nuveiPaymentService.getUserPayments(userId, type, status, parseInt(page), parseInt(limit));
    
    res.status(200).json({
      status: "success",
      data: result,
    });
  } catch (error) {
    console.error('Error getting Nuvei payment history:', error);
    return next(new AppError(`Failed to get Nuvei payment history: ${error.message}`, 500));
  }
});

// --- Get Nuvei earnings summary ---
export const getNuveiEarningsSummary = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const { period = 'all', startDate, endDate } = req.query;

  try {
    const result = await nuveiPaymentService.getEarningsSummary(userId, period, startDate, endDate);
    
    res.status(200).json({
      status: "success",
      data: result,
    });
  } catch (error) {
    console.error('Error getting Nuvei earnings summary:', error);
    return next(new AppError(`Failed to get Nuvei earnings summary: ${error.message}`, 500));
  }
});

// --- Start Nuvei onboarding ---
export const startNuveiOnboarding = catchAsync(async (req, res, next) => {
  const userId = req.user.id;

  try {
    const result = await nuveiPaymentService.startNuveiOnboarding(userId);
    
    res.status(200).json({
      status: "success",
      data: result,
    });
  } catch (error) {
    console.error('Error starting Nuvei onboarding:', error);
    return next(new AppError(`Failed to start Nuvei onboarding: ${error.message}`, 500));
  }
});

// --- Check Nuvei onboarding status ---
export const checkNuveiOnboardingStatus = catchAsync(async (req, res, next) => {
  const userId = req.user.id;

  try {
    const result = await nuveiPaymentService.checkNuveiOnboardingStatus(userId);
    
    res.status(200).json({
      status: "success",
      data: result,
    });
  } catch (error) {
    console.error('Error checking Nuvei onboarding status:', error);
    return next(new AppError(`Failed to check Nuvei onboarding status: ${error.message}`, 500));
  }
});

// --- Set default payment method ---
export const setDefaultNuveiPaymentMethod = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const { defaultPaymentMethod } = req.body;

  // Validate payment method
  if (!['stripe', 'nuvei'].includes(defaultPaymentMethod)) {
    return next(new AppError("Invalid payment method. Use 'stripe' or 'nuvei'.", 400));
  }

  try {
    const result = await nuveiPaymentService.setDefaultPaymentMethod(userId, defaultPaymentMethod);
    
    res.status(200).json({
      status: "success",
      data: result,
    });
  } catch (error) {
    console.error('Error setting default payment method:', error);
    return next(new AppError(`Failed to set default payment method: ${error.message}`, 500));
  }
});

// --- Get all payment methods for user ---
export const getUserNuveiPaymentMethods = catchAsync(async (req, res, next) => {
  const userId = req.user.id;

  try {
    const result = await nuveiPaymentService.getUserPaymentMethods(userId);
    
    res.status(200).json({
      status: "success",
      data: result,
    });
  } catch (error) {
    console.error('Error getting user payment methods:', error);
    return next(new AppError(`Failed to get payment methods: ${error.message}`, 500));
  }
});

// --- Get Nuvei balance ---
export const getNuveiBalance = catchAsync(async (req, res, next) => {
  const userId = req.user.id;

  try {
    const balance = await nuveiPaymentService.getNuveiAvailableBalance(userId);
    
    res.status(200).json({
      status: "success",
      data: {
        available: balance / 100, // Convert from cents to dollars
        availableFormatted: (balance / 100).toFixed(2),
        currency: 'CAD',
        paymentProvider: 'nuvei'
      },
    });
  } catch (error) {
    console.error('Error getting Nuvei balance:', error);
    return next(new AppError(`Failed to get Nuvei balance: ${error.message}`, 500));
  }
});

// --- Get Nuvei withdrawal history ---
export const getNuveiWithdrawalHistory = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const { page = 1, limit = 10 } = req.query;

  try {
    const result = await nuveiPaymentService.getUserNuveiWithdrawals(userId, parseInt(page), parseInt(limit));
    
    res.status(200).json({
      status: "success",
      data: result,
    });
  } catch (error) {
    console.error('Error getting Nuvei withdrawal history:', error);
    return next(new AppError(`Failed to get Nuvei withdrawal history: ${error.message}`, 500));
  }
});

// --- Handle Nuvei webhook ---
export const handleNuveiWebhook = catchAsync(async (req, res, next) => {
  const payload = req.body;
  const sig = req.headers['x-nuvei-signature'];

  try {
    // Log the received webhook for debugging
    logger.info('Nuvei webhook received:', JSON.stringify(payload, null, 2));

    // Handle different event types
    const eventType = payload.type || payload.event_type || 'unknown';
    const transactionId = payload.transactionId || payload.txnId || payload.id;

    switch (eventType) {
      case 'payment_success':
      case 'payment.succeeded':
        // Handle successful payment
        logger.info(`Nuvei payment succeeded: ${transactionId}`);
        // Update payment status in database
        break;
        
      case 'payment_failed':
      case 'payment.failed':
        // Handle failed payment
        logger.error(`Nuvei payment failed: ${transactionId}`);
        // Update payment status in database
        break;
        
      case 'refund_completed':
      case 'refund.completed':
        // Handle completed refund
        logger.info(`Nuvei refund completed: ${transactionId}`);
        // Update payment status in database
        break;
        
      case 'bank_transfer_completed':
      case 'payout.completed':
        // Handle completed bank transfer/payout
        logger.info(`Nuvei bank transfer completed: ${transactionId}`);
        // Update withdrawal status in database
        break;
        
      default:
        logger.warn(`Unhandled Nuvei event type: ${eventType}`);
        break;
    }

    res.status(200).json({ received: true });
  } catch (error) {
    logger.error('Error processing Nuvei webhook:', error);
    res.status(400).json({ error: 'Webhook error', message: error.message });
  }
});

// --- Nuvei Demo Response Handler ---
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

  // Respond with a demo page
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

// --- Nuvei Default Cancel Handler ---
export const nuveiDefaultCancel = catchAsync(async (req, res, next) => {
  console.log('Nuvei Payment Cancelled:', req.body);
  
  // Log the cancellation
  const transactionId = req.body.transaction_id || req.body.session_token || 'Unknown';
  
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