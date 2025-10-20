import Stripe from 'stripe';
import Payment from '../../models/Payment.js';
import User from '../../models/User.js';
import AppError from '../../utils/AppError.js';
import logger from '../../utils/logger.js';
import mongoose from 'mongoose';

// Initialize Stripe with the secret key from environment variables
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-04-10' });

class StripePayoutService {
  /**
   * Process withdrawal via Stripe
   */
  async processStripeWithdrawal(userId, amount) {
    try {
      // Validate amount
      if (!amount || amount <= 0) {
        throw new AppError("Valid withdrawal amount is required.", 400);
      }

      // Get user with Stripe account ID
      const user = await User.findById(userId).select("+stripeAccountId");
      if (!user || !user.stripeAccountId) {
        throw new AppError("Stripe account not connected. Please complete onboarding first.", 400);
      }

      let availableAmount = 0; // Move this outside the try block
      const requestedAmount = Math.round(amount * 100); // Convert to cents

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

        logger.debug(`[DEV MODE] Stripe withdrawal check for user ${userId}:
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
        throw new AppError(`Insufficient balance. Available: ${(availableAmount / 100).toFixed(2)}, Requested: ${amount}`, 400);
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
        
        logger.debug(`[DEV MODE] Simulated Stripe withdrawal:
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
      logger.info(`Stripe withdrawal processed for user ${userId}: ${amount} (Payout ID: ${payoutId})`);

      // Create a withdrawal record in the database
      const withdrawalData = {
        payer: userId, // User withdrawing
        payee: userId, // User receiving
        amount: requestedAmount,
        currency: 'usd',
        status: payout.status,
        stripePayoutId: payoutId,
        description: `Withdrawal to bank account via Stripe`,
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

      return {
        payoutId: payout.id,
        amount: amount,
        status: payout.status,
        method: 'stripe',
        estimatedArrival: payout.arrival_date ? new Date(payout.arrival_date * 1000) : null,
      };
    } catch (error) {
      logger.error(`Error processing Stripe withdrawal for user ${userId}:`, error);
      
      // Handle specific Stripe errors
      if (error.type === 'StripeError') {
        switch (error.code) {
          case 'insufficient_funds':
            throw new AppError("Insufficient funds in your Stripe account.", 400);
          case 'account_invalid':
            throw new AppError("Your Stripe account is not properly configured.", 400);
          case 'payout_not_allowed':
            throw new AppError("Payouts are not enabled for your account.", 400);
          default:
            throw new AppError(`Stripe error: ${error.message}`, 400);
        }
      }

      throw new AppError(`Failed to process Stripe withdrawal request: ${error.message}`, 500);
    }
  }

  /**
   * Get Stripe withdrawal history for a user
   */
  async getUserStripeWithdrawals(userId, page = 1, limit = 10) {
    try {
      const withdrawals = await Payment.find({
        payer: new mongoose.Types.ObjectId(userId),
        type: 'withdrawal',
        $or: [
          { status: 'paid' },
          { status: 'succeeded' }
        ]
      })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

      const totalWithdrawals = await Payment.countDocuments({
        payer: new mongoose.Types.ObjectId(userId),
        type: 'withdrawal',
        $or: [
          { status: 'paid' },
          { status: 'succeeded' }
        ]
      });

      return {
        withdrawals: withdrawals.map(wd => ({
          id: wd._id,
          payoutId: wd.stripePayoutId,
          amount: wd.amount / 100, // Convert from cents to dollars
          amountFormatted: (wd.amount / 100).toFixed(2),
          status: wd.status,
          createdAt: wd.createdAt,
          description: wd.description,
          currency: wd.currency.toUpperCase()
        })),
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(totalWithdrawals / limit),
          totalItems: totalWithdrawals,
          itemsPerPage: parseInt(limit)
        }
      };
    } catch (error) {
      logger.error('Error getting Stripe withdrawal history:', error);
      throw new AppError(`Failed to get Stripe withdrawal history: ${error.message}`, 500);
    }
  }

  /**
   * Get Stripe available balance for a user
   */
  async getStripeAvailableBalance(userId) {
    try {
      const user = await User.findById(userId).select("+stripeAccountId");
      
      if (!user || !user.stripeAccountId) {
        return 0; // No Stripe account connected
      }

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

        const availableAmount = totalReceived - totalWithdrawn;

        logger.debug(`[DEV MODE] Stripe available balance for user ${userId}:
          - Total received: $${(totalReceived / 100).toFixed(2)}
          - Total withdrawn: $${(totalWithdrawn / 100).toFixed(2)}
          - Available: $${(availableAmount / 100).toFixed(2)}`);

        return availableAmount;
      } else {
        // In production mode, get real balance from Stripe
        const balance = await stripe.balance.retrieve({
          stripeAccount: user.stripeAccountId,
        });

        const available = balance.available.find(b => b.currency === 'usd');
        const availableAmount = available ? available.amount : 0;

        return availableAmount;
      }
    } catch (error) {
      logger.error('Error getting Stripe available balance:', error);
      throw new AppError(`Failed to get Stripe available balance: ${error.message}`, 500);
    }
  }

  /**
   * Verify Stripe payout status
   */
  async verifyStripePayout(payoutId) {
    try {
      const payout = await stripe.payouts.retrieve(payoutId);
      
      return {
        status: payout.status,
        amount: payout.amount / 100, // Convert from cents to dollars
        amountFormatted: (payout.amount / 100).toFixed(2),
        currency: payout.currency.toUpperCase(),
        arrivalDate: payout.arrival_date ? new Date(payout.arrival_date * 1000) : null,
        description: payout.description || 'Stripe payout',
        payoutId: payout.id
      };
    } catch (error) {
      logger.error('Error verifying Stripe payout:', error);
      throw new AppError(`Failed to verify Stripe payout: ${error.message}`, 500);
    }
  }

  /**
   * Handle Stripe payout webhook (when Stripe confirms the transfer)
   */
  async handlePayoutWebhook(dataObject) {
    try {
      const payoutId = dataObject.id;

      if (!payoutId) {
        throw new AppError('Payout ID required for payout webhook', 400);
      }

      // Find the withdrawal record
      const withdrawal = await Payment.findOne({ 
        stripePayoutId: payoutId 
      });

      if (!withdrawal) {
        logger.warn(`Stripe withdrawal not found for payout: ${payoutId}`);
        return { success: false, message: 'Withdrawal record not found' };
      }

      // Update the withdrawal status based on webhook data
      withdrawal.status = dataObject.status || 'succeeded';
      if (dataObject.failure_reason) {
        withdrawal.description = `${withdrawal.description || ''} - Failed: ${dataObject.failure_reason}`;
      }
      
      await withdrawal.save();

      logger.info(`Stripe withdrawal status updated for payout ${payoutId}: ${dataObject.status}`);

      return { success: true, withdrawalId: withdrawal._id };
    } catch (error) {
      logger.error('Error handling Stripe payout webhook:', error);
      throw error;
    }
  }
}

export default new StripePayoutService();