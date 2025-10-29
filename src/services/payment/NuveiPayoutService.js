import NuveiPayment from '../../models/NuveiPayment.js';
import User from '../../models/User.js';
import AppError from '../../utils/AppError.js';
import logger from '../../utils/logger.js';
import https from 'https';
import { URL } from 'url';
import mongoose from 'mongoose';

class NuveiPayoutService {
  // Utility function to make HTTP requests to Nuvei API for payouts
  async makeNuveiPayoutRequest(endpoint, data, method = 'POST') {
    const nuveiUrl = process.env.NODE_ENV === 'production' 
      ? process.env.NUVEI_API_URL || 'https://api.nuvei.com/' 
      : process.env.NUVEI_SANDBOX_URL || 'https://sandbox.nuvei.com/';
    
    const apiUrl = new URL(endpoint, nuveiUrl);
    
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(JSON.stringify(data)),
      'Authorization': `Basic ${Buffer.from(`${process.env.NUVEI_API_KEY}:`).toString('base64')}`, // Basic auth format
    };
    
    return new Promise((resolve, reject) => {
      const req = https.request(apiUrl, {
        method,
        headers,
      }, (res) => {
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
        console.error('Nuvei API payout request failed:', error);
        reject(error);
      });
      
      if (method !== 'GET' && method !== 'HEAD') {
        req.write(JSON.stringify(data));
      }
      
      req.end();
    });
  }

  // Process withdrawal via Nuvei bank transfer
  async processNuveiWithdrawal(userId, amount) {
    try {
      // Validate user and check Nuvei bank details
      const user = await User.findById(userId);
      if (!user) {
        throw new AppError('User not found', 404);
      }

      // Check if user has Nuvei bank details configured
      if (!user.nuveiBankTransferEnabled || !user.nuveiBankDetails) {
        throw new AppError('Nuvei bank transfer not enabled or bank details not provided', 400);
      }

      if (!user.nuveiBankDetails.accountNumber || 
          !user.nuveiBankDetails.institutionNumber || 
          !user.nuveiBankDetails.transitNumber) {
        throw new AppError('Complete bank details required for Nuvei withdrawal', 400);
      }

      const requestedAmount = Math.round(amount * 100); // Convert to cents

      // Check available balance for Nuvei payments only
      const availableBalance = await this.getNuveiAvailableBalance(userId);
      
      if (requestedAmount > availableBalance) {
        return {
          success: false,
          error: `Insufficient Nuvei balance. Available: ${(availableBalance / 100).toFixed(2)}, Requested: ${amount}`
        };
      }

      // Create withdrawal record first
      const withdrawal = await NuveiPayment.create({
        payer: userId, // User withdrawing
        payee: userId, // User receiving (same user for withdrawals)
        amount: requestedAmount,
        currency: 'cad', // Nuvei system uses CAD
        status: 'processing',
        type: 'withdrawal',
        description: `Nuvei bank transfer withdrawal`,
        applicationFeeAmount: 0, // No fees for withdrawals
        taxAmount: 0, // No taxes for withdrawals
        amountReceivedByPayee: requestedAmount,
        amountAfterTax: requestedAmount,
        // Nuvei-specific fields
        nuveiMerchantId: process.env.NUVEI_MERCHANT_ID,
        nuveiMerchantSiteId: process.env.NUVEI_MERCHANT_SITE_ID,
        nuveiOrderId: `GYGG-WD-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, // Withdrawal order ID
      });

      let payoutResponse;
      
      try {
        // Prepare Nuvei payout session data for bank transfer
        const payoutData = {
          merchantId: process.env.NUVEI_MERCHANT_ID,
          merchantSiteId: process.env.NUVEI_MERCHANT_SITE_ID,
          amount: amount, // Amount in dollars (not cents)
          currency: 'CAD',
          orderId: withdrawal.nuveiOrderId, // Unique order ID
          userTokenId: userId, // User identifier
          transactionType: 'payout', // Specify this is a payout/transfer
          // Bank account details
          bankDetails: {
            accountNumber: user.nuveiBankDetails.accountNumber,
            institutionNumber: user.nuveiBankDetails.institutionNumber,
            transitNumber: user.nuveiBankDetails.transitNumber,
            accountType: user.nuveiBankDetails.accountType || 'checking',
          },
          clientRequestId: withdrawal._id.toString(), // Unique request ID
          description: `Gygg platform withdrawal to bank account`,
        };

        // Make request to Nuvei API for bank transfer
        payoutResponse = await this.makeNuveiPayoutRequest('payout/bank-transfer', payoutData);

        // Update withdrawal record with Nuvei-specific data
        withdrawal.nuveiTransactionId = payoutResponse.transactionId || payoutResponse.id;
        withdrawal.nuveiBankTransferId = payoutResponse.bankTransferId || payoutResponse.transferId;
        withdrawal.status = payoutResponse.status || 'succeeded';
        
        await withdrawal.save();

        logger.info(`Nuvei withdrawal processed for user ${userId}: ${amount} CAD (Transaction ID: ${payoutResponse.transactionId})`);

        return {
          success: true,
          payoutId: payoutResponse.transactionId,
          amount: amount,
          status: payoutResponse.status || 'succeeded',
          estimatedArrival: payoutResponse.estimatedArrival,
          withdrawalId: withdrawal._id,
          message: "Nuvei withdrawal processed successfully"
        };
      } catch (payoutError) {
        // If payout fails, update the withdrawal record and rethrow
        withdrawal.status = 'failed';
        withdrawal.description = `${withdrawal.description} - Failed: ${payoutError.message}`;
        await withdrawal.save();

        logger.error(`Nuvei withdrawal failed for user ${userId}:`, payoutError);

        throw new AppError(`Nuvei withdrawal failed: ${payoutError.message}`, 500);
      }
    } catch (error) {
      logger.error('Error processing Nuvei withdrawal:', error);
      throw error;
    }
  }

  // Get available Nuvei balance for a user
  async getNuveiAvailableBalance(userId) {
    try {
      // Calculate available balance from Nuvei payments that have succeeded
      // This includes payments received minus any withdrawals made via Nuvei
      const paymentsReceived = await NuveiPayment.find({
        payee: new mongoose.Types.ObjectId(userId),
        status: 'succeeded',
        type: 'payment'
      });

      const withdrawalsMade = await NuveiPayment.find({
        payer: new mongoose.Types.ObjectId(userId),
        status: { $in: ['succeeded', 'paid'] },
        type: 'withdrawal'
      });

      // Calculate total received from Nuvei payments
      const totalReceived = paymentsReceived.reduce((sum, payment) => {
        return sum + (payment.amountReceivedByPayee || payment.amount || 0);
      }, 0);

      // Calculate total withdrawn via Nuvei
      const totalWithdrawn = withdrawalsMade.reduce((sum, withdrawal) => {
        return sum + (withdrawal.amount || 0);
      }, 0);

      // Available balance = received - withdrawn
      const availableBalance = totalReceived - totalWithdrawn;

      logger.debug(`Nuvei balance calculation for user ${userId}:`, {
        totalReceived: totalReceived / 100,
        totalWithdrawn: totalWithdrawn / 100,
        available: availableBalance / 100
      });

      return availableBalance;
    } catch (error) {
      logger.error('Error calculating Nuvei available balance:', error);
      throw new AppError('Failed to calculate Nuvei available balance', 500);
    }
  }

  // Get Nuvei withdrawal history for a user
  async getUserNuveiWithdrawals(userId, page = 1, limit = 10) {
    try {
      const withdrawals = await NuveiPayment.find({
        payer: new mongoose.Types.ObjectId(userId),
        type: 'withdrawal'
      })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

      const totalWithdrawals = await NuveiPayment.countDocuments({
        payer: new mongoose.Types.ObjectId(userId),
        type: 'withdrawal'
      });

      return {
        withdrawals: withdrawals.map(wd => ({
          id: wd._id,
          amount: wd.amount / 100, // Convert from cents to dollars
          amountFormatted: (wd.amount / 100).toFixed(2),
          status: wd.status,
          transactionId: wd.nuveiTransactionId,
          bankTransferId: wd.nuveiBankTransferId,
          createdAt: wd.createdAt,
          description: wd.description
        })),
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(totalWithdrawals / limit),
          totalItems: totalWithdrawals,
          itemsPerPage: parseInt(limit)
        }
      };
    } catch (error) {
      logger.error('Error getting Nuvei withdrawal history:', error);
      throw new AppError('Failed to get Nuvei withdrawal history', 500);
    }
  }

  // Verify a Nuvei payout transaction
  async verifyNuveiPayout(transactionId) {
    try {
      const verificationData = {
        merchantId: process.env.NUVEI_MERCHANT_ID,
        merchantSiteId: process.env.NUVEI_MERCHANT_SITE_ID,
        transactionId,
      };

      // For a real implementation, make the actual Nuvei verification call
      // const verificationResult = await this.makeNuveiPayoutRequest('payout/verify', verificationData, 'GET');
      
      // For now, return a simulated verification result
      return { 
        status: 'verified',
        transactionId,
        verifiedAt: new Date()
      };
    } catch (error) {
      logger.error('Error verifying Nuvei payout:', error);
      throw new AppError('Failed to verify Nuvei payout', 500);
    }
  }

  // Handle Nuvei payout webhook (when Nuvei confirms the transfer)
  async handlePayoutWebhook(data) {
    try {
      const transactionId = data.transactionId || data.id;

      if (!transactionId) {
        throw new AppError('Transaction ID required for payout webhook', 400);
      }

      // Find the withdrawal record
      const withdrawal = await NuveiPayment.findOne({ 
        nuveiTransactionId: transactionId 
      });

      if (!withdrawal) {
        logger.warn(`Nuvei withdrawal not found for transaction: ${transactionId}`);
        return { success: false, message: 'Withdrawal record not found' };
      }

      // Update the withdrawal status based on webhook data
      withdrawal.status = data.status || 'succeeded';
      if (data.failureReason) {
        withdrawal.description = `${withdrawal.description || ''} - Failed: ${data.failureReason}`;
      }
      
      await withdrawal.save();

      logger.info(`Nuvei withdrawal status updated for transaction ${transactionId}: ${data.status}`);

      return { success: true, withdrawalId: withdrawal._id };
    } catch (error) {
      logger.error('Error handling Nuvei payout webhook:', error);
      throw error;
    }
  }
}

export default new NuveiPayoutService();