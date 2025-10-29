import NuveiPayment from '../../models/NuveiPayment.js';
import Contract from '../../models/Contract.js';
import User from '../../models/User.js';
import AppError from '../../utils/AppError.js';
import logger from '../../utils/logger.js';
import https from 'https';
import { URL } from 'url';
import mongoose from 'mongoose';
import crypto from 'crypto';

// Nuvei API Configuration
const NUVEI_API_BASE_URL = process.env.NODE_ENV === 'production' 
  ? process.env.NUVEI_API_URL || 'https://api.nuvei.com/'
  : process.env.NUVEI_SANDBOX_URL || 'https://sandbox.nuvei.com/';

const NUVEI_MERCHANT_ID = process.env.NUVEI_MERCHANT_ID;
const NUVEI_MERCHANT_SITE_ID = process.env.NUVEI_MERCHANT_SITE_ID;
const NUVEI_API_KEY = process.env.NUVEI_API_KEY;

// Utility function to make HTTP requests to Nuvei API
const makeNuveiRequest = async (endpoint, data, method = 'POST') => {
  // Determine the correct API base URL based on the endpoint
  let apiUrl;
  if (endpoint === 'ppro/openOrder.do' || endpoint === 'ppro/payout/bank-transfer.do' || endpoint === 'ppro/getPaymentStatus.do') {
    // Use the correct URL for the Nuvei endpoints that use checksum authentication
    apiUrl = new URL(endpoint, process.env.NODE_ENV === 'production' 
      ? process.env.NUVEI_API_URL || 'https://api.nuvei.com/' 
      : process.env.NUVEI_SANDBOX_URL || 'https://sandbox.nuvei.com/');
  } else {
    // Use the existing base URL for other endpoints
    apiUrl = new URL(endpoint, NUVEI_API_BASE_URL);
  }
  
  const headers = {
    'Content-Type': 'application/json',
  };
  
  // Add Authorization header only for endpoints that require it
  // The openOrder and certain other endpoints use checksum authentication instead
  if (endpoint !== 'ppro/openOrder.do' && endpoint !== 'ppro/payout/bank-transfer.do' && endpoint !== 'ppro/getPaymentStatus.do' && NUVEI_API_KEY) {
    headers['Authorization'] = `Bearer ${NUVEI_API_KEY}`;
  }
  
  if (method === 'GET' || method === 'HEAD') {
    // For GET requests, add query parameters to URL
    Object.keys(data || {}).forEach(key => {
      apiUrl.searchParams.append(key, data[key]);
    });
  }
  
  const options = {
    hostname: apiUrl.hostname,
    port: apiUrl.port || 443,
    path: apiUrl.pathname + apiUrl.search,
    method,
    headers,
  };
  
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let responseData = '';
      
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      
      res.on('end', () => {
        try {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(JSON.parse(responseData));
          } else {
            reject(new Error(`HTTP error! status: ${res.statusCode}, message: ${responseData}`));
          }
        } catch (error) {
          reject(error);
        }
      });
    });
    
    req.on('error', (error) => {
      console.error('Nuvei API request failed:', error);
      reject(new AppError(`Nuvei API request failed: ${error.message}`, 500));
    });
    
    if (method !== 'GET' && method !== 'HEAD' && data) {
      req.write(JSON.stringify(data));
    }
    
    req.end();
  });
};

class NuveiPaymentService {
  // Create a Nuvei payment session for a contract
  async createPaymentSession(contractId, providerId, paymentMethod = 'card') {
    try {
      // Validate contract ID
      if (!mongoose.Types.ObjectId.isValid(contractId))
        throw new AppError("Invalid Contract ID format.", 400);

      // Fetch the contract along with the tasker details
      const contract = await Contract.findById(contractId)
        .populate('gig')
        .populate('provider')
        .populate('tasker');
      if (!contract) throw new AppError("Contract not found.", 404);

      // Check if the provider is authorized to make the payment
      // The provider field could be an object with _id or a direct ObjectId reference
      const contractProviderId = typeof contract.provider === 'object' && contract.provider._id 
        ? contract.provider._id.toString() 
        : contract.provider.toString();
        
      if (contractProviderId !== providerId)
        throw new AppError("Not authorized to pay for this contract.", 403);

      // Ensure that the provider has connected their Nuvei account
      const provider = await User.findById(providerId);
      if (!provider.nuveiAccountId)
        throw new AppError("Provider must connect their Nuvei account before making payments.", 400);

      // Ensure that the contract is in a valid status for payment
      // Contracts should be in pending_payment status to accept payments
      if (![ "pending_payment", "active", "submitted", "failed" ].includes(contract.status)) {
        throw new AppError(
          `Contract not awaiting payment (status: ${contract.status}). Valid statuses: pending_payment, active, submitted, failed`,
          400
        );
      }

      // Ensure that the tasker has connected a valid Nuvei account
      if (!contract.tasker?.nuveiAccountId)
        throw new AppError("Tasker has not connected Nuvei.", 400);

      const taskerNuveiAccountId = contract.tasker.nuveiAccountId;

      // Validate that the Nuvei account actually exists
      try {
        await makeNuveiRequest(`accounts/${taskerNuveiAccountId}`, {}, 'GET');
      } catch (error) {
        if (error.code === 'account_invalid' || error.type === 'NuveiPermissionError') {
          // Clear the invalid account ID from the user
          await User.findByIdAndUpdate(contract.tasker._id, {
            $unset: { nuveiAccountId: 1, nuveiVerificationStatus: 1, nuveiBankTransferEnabled: 1 }
          });
          throw new AppError("Tasker's Nuvei account is invalid. Please reconnect Nuvei account.", 400);
        }
        // Re-throw other errors
        throw error;
      }

      // Calculate payment amount based on contract type
      let serviceAmountInCents;
      let paymentDescription;

      if (contract.isHourly) {
        // For hourly contracts, use actual hours worked
        if (!contract.actualHours || contract.actualHours <= 0) {
          throw new AppError("No approved hours found for this hourly contract. Please ensure time entries are approved before payment.", 400);
        }
        serviceAmountInCents = Math.round(contract.totalHourlyPayment * 100);
        paymentDescription = `Payment for ${contract.actualHours} hours at $${contract.hourlyRate}/hr`;
      } else {
        // For fixed contracts, use agreed cost
        serviceAmountInCents = Math.round(contract.agreedCost * 100);
        paymentDescription = `Payment for fixed-price gig`;
      }

      if (serviceAmountInCents <= 0) {
        throw new AppError("Invalid payment amount calculated.", 400);
      }

      // --- Calculate payment breakdown (same as Stripe) ---
      // Use environment variables for fee/tax configuration
      const fixedFeeCents = parseInt(process.env.PLATFORM_FIXED_FEE_CENTS) || 500; // $5.00 in cents
      const feePercentage = parseFloat(process.env.PLATFORM_FEE_PERCENT) || 0.10; // 10%
      const taxPercent = parseFloat(process.env.TAX_PERCENT) || 0.13; // 13%
      
      // Service amount (this is what the tasker receives - the agreed upon amount)
      const agreedServiceAmount = serviceAmountInCents;
      
      // Platform fee calculation (percentage of service amount + fixed fee)
      // This fee goes to the platform as revenue
      const applicationFeeAmount = Math.round(agreedServiceAmount * feePercentage) + fixedFeeCents;
      
      // Provider pays tax on the total amount they pay (service + platform fee)
      const providerTaxableAmount = agreedServiceAmount + applicationFeeAmount;
      const providerTaxAmount = Math.round(providerTaxableAmount * taxPercent);
      
      // Total tax amount (only provider tax in this model)
      const taxAmount = providerTaxAmount;
      
      // Total amount provider pays (service amount + platform fee + tax)
      const totalProviderPayment = agreedServiceAmount + applicationFeeAmount + providerTaxAmount;
      
      // Amount tasker receives (the full agreed service amount - no fees deducted)
      const amountReceivedByPayee = agreedServiceAmount;

      // --- Create/update payment record (this will trigger the pre-save hook to calculate amounts) ---
      let payment = await NuveiPayment.findOne({ contract: contractId });
      if (!payment) {
        payment = await NuveiPayment.create({
          contract: contractId,
          gig: contract.gig,
          payer: providerId,
          payee: contract.tasker._id,
          amount: serviceAmountInCents, // Base service amount
          currency: 'cad', // or based on environment
          description: paymentDescription,
          status: "requires_payment_method",
          paymentProvider: "nuvei", // Specify Nuvei as payment provider
          paymentMethodType: paymentMethod, // Store payment method type
          // Platform fee details
          applicationFeeAmount,
          providerTaxAmount,
          taxAmount,
          totalProviderPayment,
          amountReceivedByPayee,
        });
      } else if (![ "requires_payment_method", "failed" ].includes(payment.status)) {
        throw new AppError(`Payment already in status: ${payment.status}`, 400);
      } else {
        payment.amount = serviceAmountInCents;
        payment.status = "requires_payment_method";
        payment.paymentProvider = "nuvei";
        payment.paymentMethodType = paymentMethod;
        // Update fee calculations
        payment.applicationFeeAmount = applicationFeeAmount;
        payment.providerTaxAmount = providerTaxAmount;
        payment.taxAmount = taxAmount;
        payment.totalProviderPayment = totalProviderPayment;
        payment.amountReceivedByPayee = amountReceivedByPayee;
        await payment.save();
      }

      // Prepare Nuvei payment session data
      const paymentOption = paymentMethod || 'card'; // Get payment method from request, default to card
      
      const nuveiSessionData = {
        merchantId: NUVEI_MERCHANT_ID,
        merchantSiteId: NUVEI_MERCHANT_SITE_ID,
        amount: totalProviderPayment / 100, // Convert from cents to dollars
        currency: 'CAD',
        orderId: `GYGG-${payment._id}`, // Unique order ID
        userTokenId: providerId, // User identifier
        transactionType: 'sale', // Could also be 'auth' for authorization
        paymentOption: paymentOption, // Use the selected payment option
        // Additional required fields based on Nuvei documentation
        clientRequestId: payment._id.toString(), // Unique request ID
        // Additional payment method specific data will be handled by Nuvei Simply Connect
        // Do not include sensitive card data here as it should be handled securely by the SDK
      };
      
      // Add InstaDebit specific fields if needed
      if (paymentOption === 'instadebit') {
        nuveiSessionData.apm = {
          provider: 'instadebit',
          // Add any InstaDebit specific parameters here
        };
      }

      // Make request to Nuvei API to create session
      const nuveiResponse = await makeNuveiRequest('payment/session/create', nuveiSessionData);
      
      // Update payment with Nuvei-specific data
      payment.nuveiSessionId = nuveiResponse.sessionId || nuveiResponse.session_token;
      payment.nuveiTransactionId = nuveiResponse.transactionId;
      payment.nuveiMerchantId = NUVEI_MERCHANT_ID;
      payment.nuveiMerchantSiteId = NUVEI_MERCHANT_SITE_ID;
      payment.nuveiOrderId = `GYGG-${payment._id}`;
      
      await payment.save();

      logger.info(`Nuvei payment session created for contract ${contractId}: ${payment.nuveiSessionId}`);

      return {
        sessionId: payment.nuveiSessionId,
        transactionId: payment.nuveiTransactionId,
        paymentId: payment._id,
        amount: totalProviderPayment / 100,
        currency: 'CAD',
        // Provide necessary data for frontend Nuvei integration
        nuveiConfig: {
          merchantId: NUVEI_MERCHANT_ID,
          merchantSiteId: NUVEI_MERCHANT_SITE_ID,
          sessionId: payment.nuveiSessionId,
          environment: process.env.NODE_ENV === 'production' ? 'live' : 'sandbox',
        }
      };
    } catch (error) {
      logger.error('Error creating Nuvei payment session:', error);
      throw new AppError(`Failed to create Nuvei payment session: ${error.message}`, 500);
    }
  }

  // Verify a Nuvei transaction
  async verifyTransaction(transactionId) {
    try {
      const verificationData = {
        merchantId: NUVEI_MERCHANT_ID,
        merchantSiteId: NUVEI_MERCHANT_SITE_ID,
        transactionId,
      };

      // Make request to Nuvei API to verify transaction
      const verificationResult = await makeNuveiRequest('ppro/getPaymentStatus.do', verificationData, 'GET');
      
      return {
        status: 'success',
        verified: true,
        data: verificationResult
      };
    } catch (error) {
      logger.error('Error verifying Nuvei transaction:', error);
      throw new AppError('Failed to verify Nuvei transaction', 500);
    }
  }

  // Confirm Nuvei payment
  async confirmPayment(nuveiTransactionId, sessionId) {
    try {
      // Find the payment record
      const payment = await NuveiPayment.findOne({
        $or: [
          { nuveiTransactionId },
          { nuveiSessionId: sessionId }
        ]
      }).populate('contract');

      if (!payment) {
        throw new AppError('Nuvei payment record not found', 404);
      }

      // Verify the payment with Nuvei
      const verificationResult = await this.verifyTransaction(nuveiTransactionId);

      if (verificationResult.status === 'success' && verificationResult.verified) {
        // Update payment status and details
        payment.status = "succeeded";
        payment.succeededAt = new Date();
        payment.nuveiTransactionId = nuveiTransactionId;
        
        await payment.save();

        // Update contract status if needed
        if (payment.contract && payment.contract.status !== "completed") {
          payment.contract.status = "completed";
          await payment.contract.save();
        }

        logger.info(`Nuvei payment confirmed for transaction: ${nuveiTransactionId}`);

        return {
          payment: {
            id: payment._id,
            status: payment.status,
            amount: payment.amount / 100,
            transactionId: payment.nuveiTransactionId,
          },
          contract: {
            id: payment.contract._id,
            status: payment.contract.status,
          }
        };
      } else {
        throw new AppError('Nuvei payment verification failed', 400);
      }
    } catch (error) {
      logger.error('Error confirming Nuvei payment:', error);
      throw error;
    }
  }

  // Get payment by session ID
  async getPaymentBySessionId(sessionId) {
    try {
      const payment = await NuveiPayment.findOne({ nuveiSessionId: sessionId })
        .populate('contract', 'title')
        .populate('payer', 'firstName lastName email')
        .populate('payee', 'firstName lastName email');
      
      if (!payment) {
        throw new AppError("Nuvei payment session not found.", 404);
      }

      return {
        sessionId: payment.nuveiSessionId,
        paymentId: payment._id,
        status: payment.status,
        amount: payment.amount / 100,
        currency: payment.currency,
        contract: payment.contract,
        payer: payment.payer,
        payee: payment.payee,
        createdAt: payment.createdAt,
      };
    } catch (error) {
      logger.error('Error getting Nuvei payment by session ID:', error);
      throw error;
    }
  }

  // Get user payments
  async getUserPayments(userId, type = 'all', status = 'all', page = 1, limit = 10) {
    try {
      // Build query filter
      let matchFilter = {};

      // Type and role-based filtering
      let queries = [];

      if (type === 'all' || type === 'earned') {
        queries.push({
          payee: new mongoose.Types.ObjectId(userId),
          type: 'payment'
        });
      }

      if (type === 'all' || type === 'spent') {
        queries.push({
          payer: new mongoose.Types.ObjectId(userId),
          type: 'payment'
        });
      }

      if (type === 'all' || type === 'withdrawals') {
        queries.push({
          payer: new mongoose.Types.ObjectId(userId),
          type: 'withdrawal'
        });
      }

      // Status filter
      if (status !== 'all') {
        matchFilter.status = status;
      }

      if (queries.length === 0) {
        return {
          payments: [],
          pagination: {
            currentPage: 1,
            totalPages: 0,
            totalItems: 0,
            itemsPerPage: parseInt(limit)
          }
        };
      }

      // Combine queries with $or
      const finalFilter = queries.length === 1 ? queries[0] : { $or: queries };
      Object.assign(finalFilter, matchFilter);

      // Get total count
      const totalItems = await NuveiPayment.countDocuments(finalFilter);
      const totalPages = Math.ceil(totalItems / limit);

      // Get payments with pagination
      const payments = await NuveiPayment.find(finalFilter)
        .populate('contract', 'gig status')
        .populate('gig', 'title')
        .populate('payer', 'firstName lastName email')
        .populate('payee', 'firstName lastName email')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit));

      // Format payments for response
      const formattedPayments = payments.map(payment => ({
        _id: payment._id,
        id: payment._id,
        type: payment.type,
        status: payment.status,
        amount: payment.amount / 100,
        amountFormatted: (payment.amount / 100).toFixed(2),
        amountReceivedByPayee: payment.amountReceivedByPayee / 100,
        amountReceivedFormatted: (payment.amountReceivedByPayee / 100).toFixed(2),
        totalProviderPayment: payment.totalProviderPayment / 100,
        totalProviderPaymentFormatted: (payment.totalProviderPayment / 100).toFixed(2),
        applicationFeeAmount: payment.applicationFeeAmount / 100,
        applicationFeeFormatted: (payment.applicationFeeAmount / 100).toFixed(2),
        taxAmount: payment.taxAmount / 100,
        taxAmountFormatted: (payment.taxAmount / 100).toFixed(2),
        currency: payment.currency.toUpperCase(),
        description: payment.description,
        createdAt: payment.createdAt,
        succeededAt: payment.succeededAt,
        contract: payment.contract,
        gig: payment.gig,
        payer: payment.payer,
        payee: payment.payee,
        paymentMethodType: payment.paymentMethodType,
        nuveiTransactionId: payment.nuveiTransactionId,
        nuveiSessionId: payment.nuveiSessionId,
        // Determine user's role in this payment
        userRole: payment.payer._id.toString() === userId ? 'payer' : 'payee'
      }));

      return {
        payments: formattedPayments,
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalItems,
          itemsPerPage: parseInt(limit)
        }
      };
    } catch (error) {
      logger.error('Error getting user Nuvei payments:', error);
      throw new AppError('Failed to retrieve Nuvei payment history.', 500);
    }
  }

  // Get earnings summary
  async getEarningsSummary(userId, period = 'all', startDate, endDate) {
    try {
      const user = await User.findById(userId).select("role");
      if (!user) {
        throw new AppError("User not found.", 404);
      }

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
      } else if (startDate && endDate) {
        dateFilter.createdAt = {
          $gte: new Date(startDate),
          $lte: new Date(endDate)
        };
      }

      let summary = {};

      // For Taskers - Money they've earned via Nuvei
      if (user.role.includes('tasker')) {
        const taskerPayments = await NuveiPayment.aggregate([
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

        const withdrawals = await NuveiPayment.aggregate([
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

        summary.nuveiTasker = {
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
        };
      }

      // For Providers - Money they've spent via Nuvei
      if (user.role.includes('provider')) {
        const providerPayments = await NuveiPayment.aggregate([
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

        summary.nuveiProvider = {
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

      return {
        period,
        summary,
        currency: 'CAD',
        paymentProvider: 'nuvei'
      };
    } catch (error) {
      logger.error('Error getting Nuvei earnings summary:', error);
      throw new AppError("Failed to retrieve Nuvei earnings summary.", 500);
    }
  }

  // Start Nuvei onboarding for a user
  async startNuveiOnboarding(userId) {
    try {
      // Check if user already has a Nuvei account
      const user = await User.findById(userId);
      
      if (!user) {
        throw new AppError('User not found', 404);
      }

      // If user doesn't have a Nuvei account ID, create one
      if (!user.nuveiAccountId) {
        // In a real implementation, you would call Nuvei's API to create an account
        // For now, we'll simulate by generating a mock account ID
        const mockAccountId = `nuv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        user.nuveiAccountId = mockAccountId;
        user.nuveiCustomerId = `cust_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        await user.save();
      }

      // Generate a mock onboarding URL (in real implementation, call Nuvei API)
      const onboardingUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/settings/payment?nuvei_onboarding=1&accountId=${user.nuveiAccountId}`;

      return {
        onboardingUrl,
        accountId: user.nuveiAccountId,
        customerId: user.nuveiCustomerId,
        message: "Nuvei onboarding session started successfully"
      };
    } catch (error) {
      logger.error('Error starting Nuvei onboarding:', error);
      throw new AppError(`Failed to start Nuvei onboarding: ${error.message}`, 500);
    }
  }

  // Check Nuvei onboarding status
  async checkNuveiOnboardingStatus(userId) {
    try {
      const user = await User.findById(userId);
      
      if (!user) {
        throw new AppError('User not found', 404);
      }

      // Mock implementation - in reality, you would call Nuvei API
      const status = user.nuveiAccountId ? 'completed' : 'not_started';
      const connected = !!user.nuveiAccountId;
      const bankTransferEnabled = user.nuveiBankTransferEnabled || false;
      
      return {
        status,
        connected,
        bankTransferEnabled,
        accountId: user.nuveiAccountId,
        customerId: user.nuveiCustomerId,
        verificationStatus: user.nuveiVerificationStatus || 'pending',
        message: connected 
          ? "Nuvei account connected successfully" 
          : "No Nuvei account connected"
      };
    } catch (error) {
      logger.error('Error checking Nuvei onboarding status:', error);
      throw new AppError(`Failed to check Nuvei onboarding status: ${error.message}`, 500);
    }
  }

  // Set default payment method
  async setDefaultPaymentMethod(userId, defaultPaymentMethod) {
    try {
      // Validate payment method
      if (!['stripe', 'nuvei'].includes(defaultPaymentMethod)) {
        throw new AppError("Invalid payment method. Use 'stripe' or 'nuvei'.", 400);
      }

      const user = await User.findByIdAndUpdate(
        userId,
        { defaultPaymentMethod },
        { new: true, runValidators: true }
      );

      if (!user) {
        throw new AppError('User not found', 404);
      }

      return {
        defaultPaymentMethod: user.defaultPaymentMethod,
        message: `Default payment method set to ${defaultPaymentMethod}`
      };
    } catch (error) {
      logger.error('Error setting default payment method:', error);
      throw new AppError(`Failed to set default payment method: ${error.message}`, 500);
    }
  }

  // Get all payment methods for user
  async getUserPaymentMethods(userId) {
    try {
      const user = await User.findById(userId);
      
      if (!user) {
        throw new AppError('User not found', 404);
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
          bankTransferEnabled: user.nuveiBankTransferEnabled,
          bankDetails: user.nuveiBankDetails,
          default: user.defaultPaymentMethod === 'nuvei'
        },
        defaultMethod: user.defaultPaymentMethod || 'stripe'
      };

      return {
        methods,
        message: "Payment methods retrieved successfully"
      };
    } catch (error) {
      logger.error('Error getting user payment methods:', error);
      throw new AppError(`Failed to get payment methods: ${error.message}`, 500);
    }
  }

  // Process Nuvei withdrawal
  async processNuveiWithdrawal(userId, amount) {
    try {
      // Validate user and check Nuvei bank details
      const user = await User.findById(userId);
      if (!user) {
        throw new AppError('User not found', 404);
      }

      // Check if user has Nuvei bank details configured
      if (!user.nuveiAccountId || !user.nuveiBankTransferEnabled || !user.nuveiBankDetails) {
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
        providerTaxAmount: 0, // No taxes for withdrawals
        taxAmount: 0, // No taxes for withdrawals
        amountReceivedByPayee: requestedAmount,
        amountAfterTax: requestedAmount,
        totalProviderPayment: requestedAmount,
        // Nuvei-specific fields
        nuveiMerchantId: NUVEI_MERCHANT_ID,
        nuveiMerchantSiteId: NUVEI_MERCHANT_SITE_ID,
        nuveiOrderId: `GYGG-WD-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, // Withdrawal order ID
        nuveiSessionId: `ses_GYGG-WD-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, // Session ID for tracking
        paymentMethodType: 'bank_transfer', // Withdrawals use bank transfer method
        nuveiPaymentMethod: 'apm', // Withdrawals are considered APMs
        nuveiApmProvider: 'instadebit', // Specify InstaDebit as the APM provider
      });

      let payoutResponse;
      
      try {
        // Prepare Nuvei bank transfer data for withdrawal
        const transferData = {
          merchantId: NUVEI_MERCHANT_ID,
          merchantSiteId: NUVEI_MERCHANT_SITE_ID,
          amount: amount, // Amount in dollars (not cents)
          currency: 'CAD',
          orderId: withdrawal.nuveiOrderId, // Unique order ID
          userTokenId: userId, // User identifier
          transactionType: 'bank_transfer', // Specify this is a bank transfer
          paymentOption: 'instadebit', // Use InstaDebit for direct bank transfers
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
        payoutResponse = await makeNuveiRequest('ppro/payout/bank-transfer.do', transferData);

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
        return sum + (payment.amountReceivedByPayee || 0);
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

  // --- Nuvei Simply Connect Payment Methods ---

  /**
   * Create a Simply Connect payment session for a contract
   * @param {string} contractId - The ID of the contract
   * @param {string} providerId - The ID of the provider (user initiating payment)
   * @param {number} amount - The amount to charge
   * @param {string} currency - The currency code (default: CAD for Canadian market)
   * @returns {Promise<Object>} - The payment session data
   */
  async createSimplyConnectSession(contractId, providerId, amount, currency = 'CAD') {
    try {
      // Validate contract exists and belongs to provider
      if (!mongoose.Types.ObjectId.isValid(contractId)) {
        throw new AppError('Invalid Contract ID format', 400);
      }
      
      const contract = await Contract.findById(contractId)
        .populate('gig')
        .populate('provider')
        .populate('tasker');
      
      if (!contract) {
        throw new AppError('Contract not found', 404);
      }
      
      // Validate provider exists and is authorized
      if (!mongoose.Types.ObjectId.isValid(providerId)) {
        throw new AppError('Invalid Provider ID format', 400);
      }
      
      // Check if the provider is authorized to make the payment
      // The provider field could be an object with _id or a direct ObjectId reference
      const contractProviderId = typeof contract.provider === 'object' && contract.provider._id 
        ? contract.provider._id.toString() 
        : contract.provider.toString();
        
      if (contractProviderId !== providerId) {
        throw new AppError('Not authorized to pay for this contract', 403);
      }
      
      // Check contract status - it should be valid for payment
      const validPaymentStatuses = ['pending_payment', 'active']; // Allow active contracts too
      if (!validPaymentStatuses.includes(contract.status)) {
        throw new AppError(`Contract is not in a valid status for payment (current: ${contract.status}). Valid statuses: ${validPaymentStatuses.join(', ')}`, 400);
      }

      // For Simply Connect, we don't require either provider or tasker to have Nuvei accounts pre-connected
      // Users can pay directly through the Simply Connect payment flow
      const provider = await User.findById(providerId);
      if (!provider) {
        throw new AppError('Provider not found', 404);
      }
      
      // Ensure that the tasker has connected a valid payment account (either Stripe or Nuvei)
      // This is still required to ensure the tasker can receive payments
      if (!contract.tasker) {
        throw new AppError("Tasker information is missing from contract.", 400);
      }
      
      const tasker = await User.findById(contract.tasker._id);
      if (!tasker) {
        throw new AppError("Tasker not found.", 404);
      }
      
      // Tasker must have either Stripe or Nuvei account connected to receive payments
      const hasTaskerPaymentMethod = tasker.stripeAccountId || tasker.nuveiAccountId;
      if (!hasTaskerPaymentMethod) {
        throw new AppError("Tasker must connect their payment account (Stripe or Nuvei) before payments can be made.", 400);
      }

      // Validate amount parameter
      if (!amount || typeof amount !== 'number' || amount <= 0) {
        throw new AppError("Invalid amount provided. Amount must be a positive number.", 400);
      }

      // Calculate payment amount based on contract type
      // For Simply Connect, we allow the provider to specify the amount rather than requiring actualHours
      let serviceAmountInCents;
      let paymentDescription;

      if (contract.isHourly) {
        // For hourly contracts, we can use either actual hours or the provided amount
        if (amount && amount > 0) {
          // Use the provided amount for Simply Connect
          serviceAmountInCents = Math.round(amount * 100);
          paymentDescription = `Payment for hourly gig (amount specified by provider)`;
        } else if (contract.actualHours && contract.actualHours > 0) {
          // Fall back to actual hours if available
          serviceAmountInCents = Math.round(contract.totalHourlyPayment * 100);
          paymentDescription = `Payment for ${contract.actualHours} hours at ${contract.hourlyRate}/hr`;
        } else {
          // Neither provided amount nor actual hours available
          throw new AppError("No payment amount specified. Please provide an amount or ensure time entries are approved before payment.", 400);
        }
      } else {
        // For fixed contracts, we can use either the agreed cost or the provided amount
        if (amount && amount > 0) {
          // Use the provided amount for Simply Connect
          serviceAmountInCents = Math.round(amount * 100);
          paymentDescription = `Payment for fixed-price gig (amount specified by provider)`;
        } else {
          // Fall back to agreed cost
          serviceAmountInCents = Math.round(contract.agreedCost * 100);
          paymentDescription = `Payment for fixed-price gig`;
        }
      }

      // Use the provided amount instead of calculated amount for Simply Connect
      // This allows for more flexibility in the payment amount
      const providedAmountInCents = Math.round(amount * 100);
      
      // Validate the provided amount makes sense
      if (providedAmountInCents <= 0) {
        throw new AppError("Valid payment amount (minimum $0.01) is required", 400);
      }

      // If using contract amount, validate it
      if (serviceAmountInCents <= 0) {
        throw new AppError("Invalid payment amount calculated from contract", 400);
      }
      
      // Check for reasonable amount limits to prevent errors
      const maxAmount = 100000000; // $1,000,000 in cents - reasonable limit
      if (providedAmountInCents > maxAmount) {
        throw new AppError("Payment amount exceeds maximum allowed limit.", 400);
      }

      // Generate a unique client request ID
      const clientRequestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // --- Calculate payment breakdown (same as Stripe) ---
      // Use environment variables for fee/tax configuration
      const fixedFeeCents = parseInt(process.env.PLATFORM_FIXED_FEE_CENTS) || 500; // $5.00 in cents
      const feePercentage = parseFloat(process.env.PLATFORM_FEE_PERCENT) || 0.10; // 10%
      const taxPercent = parseFloat(process.env.TAX_PERCENT) || 0.13; // 13%
      
      // Service amount (this is what the tasker receives - the agreed upon amount)
      const agreedServiceAmount = serviceAmountInCents;
      
      // Platform fee calculation (percentage of service amount + fixed fee)
      // This fee goes to the platform as revenue
      const applicationFeeAmount = Math.round(agreedServiceAmount * feePercentage) + fixedFeeCents;
      
      // Provider pays tax on the total amount they pay (service + platform fee)
      const providerTaxableAmount = agreedServiceAmount + applicationFeeAmount;
      const providerTaxAmount = Math.round(providerTaxableAmount * taxPercent);
      
      // Total tax amount (only provider tax in this model)
      const taxAmount = providerTaxAmount;
      
      // Total amount provider pays (service amount + platform fee + tax)
      const totalProviderPayment = agreedServiceAmount + applicationFeeAmount + providerTaxAmount;
      
      // Amount tasker receives (the full agreed service amount - no fees deducted)
      const amountReceivedByPayee = agreedServiceAmount;

      // --- Create payment record ---
      // Create/update payment record (this will trigger the pre-save hook to calculate amounts)
      let payment = await NuveiPayment.findOne({ contract: contractId });
      if (!payment) {
        payment = await NuveiPayment.create({
          contract: contractId,
          gig: contract.gig,
          payer: providerId,
          payee: contract.tasker._id,
          amount: serviceAmountInCents, // Base service amount
          currency: currency.toLowerCase(), // Store currency
          description: paymentDescription,
          status: "requires_payment_method",
          paymentProvider: "nuvei", // Specify Nuvei as payment provider
          paymentMethodType: 'card', // Default to credit card for Simply Connect
          // Platform fee details
          applicationFeeAmount,
          providerTaxAmount,
          taxAmount,
          totalProviderPayment,
          amountReceivedByPayee,
          // Simply Connect specific details
          isSimplyConnect: true,
        });
      } else if (!["requires_payment_method", "failed"].includes(payment.status)) {
        throw new AppError(`Payment already in status: ${payment.status}`, 400);
      } else {
        payment.amount = serviceAmountInCents;
        payment.status = "requires_payment_method";
        payment.paymentProvider = "nuvei";
        payment.paymentMethodType = 'card'; // Default to credit card for Simply Connect
        payment.isSimplyConnect = true;
        // Update fee calculations
        payment.applicationFeeAmount = applicationFeeAmount;
        payment.providerTaxAmount = providerTaxAmount;
        payment.taxAmount = taxAmount;
        payment.totalProviderPayment = totalProviderPayment;
        payment.amountReceivedByPayee = amountReceivedByPayee;
        await payment.save();
      }

      // Prepare data for Nuvei API call
      const nuveiSimplyConnectData = {
        merchantId: NUVEI_MERCHANT_ID,
        merchantSiteId: NUVEI_MERCHANT_SITE_ID,
        clientRequestId,
        amount: totalProviderPayment / 100, // Convert from cents to dollars
        currency: currency.toUpperCase(),
        orderId: `GYGG-${payment._id}`, // Unique order ID
        transactionType: 'Auth', // Authorization transaction
        paymentOption: 'CC', // Default to credit card
        userTokenId: providerId, // User identifier
        returnUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/contracts?nuvei_response=1`,
        cancelUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/contracts?nuvei_cancel=1`,
        // Additional fields required by Nuvei Simply Connect
        billingAddress: {
          // Add billing address if available from user profile
        },
        shippingAddress: {
          // Add shipping address if applicable
        },
        // Customer information
        customer: {
          userTokenId: providerId,
          email: provider.email,
          firstName: provider.firstName,
          lastName: provider.lastName,
        },
        // Items/services being paid for
        items: [{
          name: paymentDescription,
          quantity: 1,
          price: totalProviderPayment / 100,
          type: contract.isHourly ? 'service' : 'product',
        }],
        // Platform fee information for Nuvei
        platform: {
          feeAmount: applicationFeeAmount / 100,
          taxAmount: providerTaxAmount / 100,
          totalAmount: totalProviderPayment / 100,
        },
        // Tasker information for payout routing
        beneficiary: {
          id: contract.tasker._id.toString(),
          nuveiAccountId: contract.tasker.nuveiAccountId,
        },
      };

      // Calculate timestamp for Nuvei API request
      const timeStamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/g, '');
      
      // Calculate checksum for Nuvei /openOrder request
      // Format: merchantId + merchantSiteId + clientRequestId + amount + currency + timeStamp + merchantSecretKey
      const checksumString = NUVEI_MERCHANT_ID + NUVEI_MERCHANT_SITE_ID + clientRequestId + 
                             (totalProviderPayment / 100).toString() + currency.toUpperCase() + 
                             timeStamp + NUVEI_API_KEY;
                             
      // Calculate SHA-256 hash
      const checksum = crypto.createHash('sha256').update(checksumString).digest('hex');

      // Prepare data for Nuvei /openOrder API call
      // Include fields that help with APM selection, especially for InstaDebit
      const openOrderData = {
        merchantId: NUVEI_MERCHANT_ID,
        merchantSiteId: NUVEI_MERCHANT_SITE_ID,
        clientUniqueId: `GYGG-${payment._id}`, // Unique transaction ID in merchant system
        clientRequestId: clientRequestId, // Unique request ID in merchant system
        currency: currency.toUpperCase(),
        amount: (totalProviderPayment / 100).toString(), // Convert from cents to dollars
        timeStamp: timeStamp,
        checksum: checksum,
        // Additional fields to help with APM selection (especially InstaDebit for Canadian users)
        country: 'CA', // Important for InstaDebit availability
        language: 'en', // Language preference
        // URL details for proper redirect handling with APMs like InstaDebit
        urlDetails: {
          successUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/contracts?nuvei_response=1&status=success`,
          failureUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/contracts?nuvei_response=1&status=failure`,
          pendingUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/contracts?nuvei_response=1&status=pending`,
          notificationUrl: `${process.env.BACKEND_URL || 'http://localhost:5000'}/api/v1/payments/nuvei/webhook`
        }
      };

      // Simply Connect uses the openOrder API call which needs proper parameters
      // Create the payment record first
      payment.nuveiSessionId = clientRequestId; // Use clientRequestId as session identifier
      payment.nuveiMerchantId = NUVEI_MERCHANT_ID;
      payment.nuveiMerchantSiteId = NUVEI_MERCHANT_SITE_ID;
      payment.nuveiOrderId = openOrderData.clientUniqueId;
      payment.nuveiClientRequestId = clientRequestId;
      payment.isSimplyConnect = true;
      
      await payment.save();

      // For Simply Connect UI, return the parameters needed for the checkout configuration
      // Include a sessionId for compatibility with frontend expectations
      const response = {
        paymentId: payment._id.toString(),
        sessionId: clientRequestId, // This will be used as the sessionToken for the checkout
        merchantId: NUVEI_MERCHANT_ID,
        merchantSiteId: NUVEI_MERCHANT_SITE_ID,
        clientRequestId,
        currency: currency.toUpperCase(), // CAD for Canadian market
        amount: totalProviderPayment / 100, // Convert from cents to dollars
        contractId,
        providerId,
        // For embedded Simply Connect UI, not redirect parameters
        // returnUrl, cancelUrl, etc. are configured in the checkout() call instead
        // Parameters for checkout() initialization
        checkoutParams: {
          sessionToken: clientRequestId, // This will be the sessionToken for checkout()
          merchantId: NUVEI_MERCHANT_ID,
          merchantSiteId: NUVEI_MERCHANT_SITE_ID,
          amount: totalProviderPayment / 100, // Convert from cents to dollars
          currency: currency.toUpperCase(),
          country: 'CA', // Canada for InstaDebit availability
          locale: 'en', // English language
          clientRequestId: clientRequestId,
          orderId: openOrderData.clientUniqueId,
          customerEmail: provider.email,
          customerFullName: `${provider.firstName} ${provider.lastName}`,
          // Additional parameters for checkout
          urlDetails: {
            successUrl: openOrderData.urlDetails.successUrl,
            failureUrl: openOrderData.urlDetails.failureUrl,
            pendingUrl: openOrderData.urlDetails.pendingUrl,
            notificationUrl: openOrderData.urlDetails.notificationUrl
          },
          // Billing address for APM (like InstaDebit) requirements
          billingAddress: {
            email: provider.email,
            country: 'CA',
            stateCode: provider.stateCode || 'ON', 
            city: provider.city || 'Toronto',
            zip: provider.zipCode || 'M5V 3A8',
            address: provider.address || '123 Main St',
          }
        },
        // APM (Alternative Payment Method) support information
        apmSupport: {
          instaDebit: {
            available: currency.toUpperCase() === 'CAD' && true, // InstaDebit available for CAD transactions
            currency: 'CAD',
            countries: ['CA'], // InstaDebit only available in Canada
            note: 'InstaDebit is only available for Canadian customers paying in CAD'
          }
        },
        // Payment breakdown details
        feeDetails: {
          platformFee: applicationFeeAmount / 100,
          tax: taxAmount / 100,
          totalProviderPayment: totalProviderPayment / 100,
          amountReceivedByPayee: amountReceivedByPayee / 100,
        }
      };
      
      await payment.save();

      // Log the session creation for debugging
      logger.info('Nuvei Simply Connect session created', {
        sessionId: clientRequestId, // Using clientRequestId as the session identifier
        contractId,
        amount: totalProviderPayment / 100,
        currency: currency.toUpperCase(),
        providerId
      });

      return response;
    } catch (error) {
      logger.error('Error creating Nuvei Simply Connect session:', error);
      throw new AppError(`Failed to create Nuvei Simply Connect session: ${error.message}`, 500);
    }
  }

  /**
   * Confirm Simply Connect payment completion
   * @param {string} contractId - The ID of the contract
   * @param {string} providerId - The ID of the provider (user confirming payment)
   * @param {string} transactionId - The Nuvei transaction ID
   * @param {Object} paymentResult - The payment result data from Nuvei
   * @returns {Promise<Object>} - The confirmation result
   */
  async confirmSimplyConnectPayment(contractId, providerId, transactionId, paymentResult) {
    try {
      // Validate input parameters
      if (!mongoose.Types.ObjectId.isValid(contractId)) {
        throw new AppError('Invalid Contract ID format', 400);
      }
      
      if (!mongoose.Types.ObjectId.isValid(providerId)) {
        throw new AppError('Invalid Provider ID format', 400);
      }
      
      if (!transactionId || typeof transactionId !== 'string' || transactionId.trim().length === 0) {
        throw new AppError('Transaction ID is required and must be a non-empty string', 400);
      }

      // Validate contract exists and belongs to provider
      const contract = await Contract.findById(contractId)
        .populate('gig')
        .populate('provider')
        .populate('tasker');
      
      if (!contract) {
        throw new AppError('Contract not found', 404);
      }
      
      // Check if the provider is authorized to confirm the payment
      // The provider field could be an object with _id or a direct ObjectId reference
      const contractProviderId = typeof contract.provider === 'object' && contract.provider._id 
        ? contract.provider._id.toString() 
        : contract.provider.toString();
        
      if (contractProviderId !== providerId) {
        throw new AppError('Not authorized to confirm payment for this contract', 403);
      }

      // Find the payment record for this contract
      const payment = await NuveiPayment.findOne({ 
        contract: contractId,
        status: "requires_payment_method" 
      });

      if (!payment) {
        // Check if payment already exists and is already processed
        const existingPayment = await NuveiPayment.findOne({ contract: contractId });
        if (existingPayment) {
          if (existingPayment.status !== "requires_payment_method") {
            throw new AppError(`Payment for this contract is already ${existingPayment.status}`, 400);
          }
        }
        throw new AppError('Nuvei payment record not found for this contract', 404);
      }

      // Check if we've already processed this transaction to prevent duplicate processing
      if (payment.nuveiTransactionId === transactionId) {
        logger.warn('Duplicate confirmation request received for transaction', { 
          transactionId, 
          contractId,
          paymentId: payment._id 
        });
        return {
          message: 'Payment was already confirmed',
          payment: {
            id: payment._id,
            status: payment.status,
            amount: payment.totalProviderPayment / 100,
            transactionId: payment.nuveiTransactionId,
          },
          contract: {
            id: contract._id,
            status: contract.status,
            paymentStatus: contract.paymentStatus
          }
        };
      }

      // In sandbox environment, we can't verify with Nuvei API due to missing endpoints
      // So we'll simulate the verification result based on the frontend's transaction info
      // In production, this would call the actual Nuvei API
      let verificationResult;
      
      // Check if we're in development mode (sandbox) to handle differently  
      if (process.env.NODE_ENV !== 'production') {
        // For sandbox environment, simulate successful verification
        verificationResult = {
          transactionId: transactionId,
          transactionStatus: 'APPROVED',
          result: 'APPROVED',
          status: 'SUCCESS',
          sessionId: payment.nuveiSessionId,
          // Include other fields that would normally come from Nuvei
          authCode: 'TEST_AUTH',
          processorReferenceNumber: 'TEST_REF',
        };
      } else {
        // For production, verify the payment with Nuvei API using /getPaymentStatus
        // This endpoint requires the sessionToken from the original /openOrder call
        try {
          verificationResult = await makeNuveiRequest('ppro/getPaymentStatus.do', {
            sessionToken: payment.nuveiSessionId // Use the sessionToken from the original /openOrder call
          }, 'POST');
        } catch (verificationError) {
          logger.error('Failed to verify Nuvei Simply Connect payment:', {
            error: verificationError.message,
            transactionId,
            contractId,
            paymentId: payment._id
          });
          
          // Update payment status to failed due to verification failure
          payment.status = "failed";
          payment.failureReason = `Verification failed: ${verificationError.message}`;
          await payment.save();
          
          throw new AppError(`Nuvei payment verification failed: ${verificationError.message}`, 500);
        }
      }

      // Check if transaction was successful based on Nuvei's response
      const isVerified = verificationResult.transactionStatus === 'APPROVED' ||
                        verificationResult.result === 'APPROVED' ||
                        verificationResult.status === 'SUCCESS';

      if (!isVerified) {
        // Log the verification failure
        logger.warn('Nuvei payment verification failed', {
          transactionId,
          contractId,
          verificationResult,
          providerId
        });
        
        // Update payment status to failed
        payment.status = "failed";
        payment.failureReason = verificationResult.transactionStatus || verificationResult.result || verificationResult.status || 'unknown';
        payment.verificationResult = verificationResult;
        await payment.save();
        
        throw new AppError(`Nuvei payment verification failed: ${verificationResult.transactionStatus || verificationResult.result || verificationResult.status || 'unknown'}`, 400);
      }

      // Update payment status and details after successful verification
      payment.status = "succeeded";
      payment.succeededAt = new Date();
      payment.nuveiTransactionId = verificationResult.transactionId || transactionId;
      payment.nuveiSessionId = paymentResult?.SessionId || payment.nuveiSessionId;
      payment.paymentMethodType = paymentResult?.PaymentMethod || 'card';
      payment.gatewayResponse = paymentResult;
      payment.verificationResult = verificationResult; // Store verification result
      
      await payment.save();

      // Update contract status to completed
      contract.status = 'completed';
      contract.completedAt = new Date();
      contract.paymentStatus = 'paid'; // Add payment status to contract
      await contract.save();

      // Log the successful payment
      logger.info('Nuvei Simply Connect payment confirmed', {
        transactionId: payment.nuveiTransactionId,
        contractId,
        amount: payment.totalProviderPayment / 100,
        providerId
      });

      return {
        message: 'Payment confirmed successfully',
        payment: {
          id: payment._id,
          status: payment.status,
          amount: payment.totalProviderPayment / 100,
          transactionId: payment.nuveiTransactionId,
        },
        contract: {
          id: contract._id,
          status: contract.status,
          paymentStatus: contract.paymentStatus
        }
      };
    } catch (error) {
      logger.error('Error confirming Nuvei Simply Connect payment:', {
        error: error.message,
        stack: error.stack,
        contractId,
        providerId,
        transactionId
      });
      
      // Ensure we always throw an AppError for proper error handling
      if (!(error instanceof AppError)) {
        throw new AppError(`Failed to confirm Nuvei Simply Connect payment: ${error.message}`, 500);
      }
      throw error;
    }
  }
}


export default new NuveiPaymentService();
