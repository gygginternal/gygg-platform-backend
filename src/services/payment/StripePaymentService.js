import Stripe from 'stripe';
import Payment from '../../models/Payment.js';
import Contract from '../../models/Contract.js';
import User from '../../models/User.js';
import AppError from '../../utils/AppError.js';
import logger from '../../utils/logger.js';
import mongoose from 'mongoose';

// Initialize Stripe with the secret key from environment variables
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-04-10' });

class StripePaymentService {
  /**
   * Create a Stripe payment intent for a contract
   */
  async createPaymentIntentForContract(contractId, providerId) {
    try {
      // Check if the contractId is valid
      if (!mongoose.Types.ObjectId.isValid(contractId))
        throw new AppError("Invalid Contract ID format.", 400);

      // Fetch the contract along with the tasker details
      const contract = await Contract.findById(contractId);

      if (!contract) throw new AppError("Contract not found.", 404);

      // Check if the provider is authorized to make the payment
      if (contract.provider._id.toString() !== providerId)
        throw new AppError("Not authorized to pay for this contract.", 403);

      // Ensure that the provider has connected their Stripe account
      const provider = await User.findById(providerId);
      if (!provider.stripeAccountId)
        throw new AppError("Provider must connect their Stripe account before making payments.", 400);

      // Ensure that the contract is in a valid status for payment
      if (!["active", "submitted", "failed"].includes(contract.status)) {
        throw new AppError(
          `Contract not awaiting payment (status: ${contract.status}).`,
          400
        );
      }

      // Ensure that the tasker has connected a valid Stripe account
      if (!contract.tasker?.stripeAccountId)
        throw new AppError("Tasker has not connected Stripe.", 400);

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
          throw new AppError("Tasker's Stripe account is invalid. Please reconnect Stripe account.", 400);
        }
        throw error; // Re-throw other errors
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
        throw new AppError(`Payment already in status: ${payment.status}`, 400);
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

      return {
        clientSecret: paymentIntent.client_secret,
        paymentId: payment._id,
      };
    } catch (error) {
      logger.error('Error creating Stripe payment intent:', error);
      throw error;
    }
  }

  /**
   * Release a payment for a contract (escrow release)
   */
  async releasePaymentForContract(contractId, providerId) {
    try {
      // Validate contract ID
      if (!mongoose.Types.ObjectId.isValid(contractId))
        throw new AppError("Invalid Contract ID format.", 400);

      // Find the contract and payment
      const contract = await Contract.findById(contractId);
      if (!contract) throw new AppError("Contract not found.", 404);

      // Verify the provider is authorized to release the payment
      if (contract.provider._id.toString() !== providerId)
        throw new AppError("Not authorized to release this payment.", 403);

      // Find the payment record
      const payment = await Payment.findOne({ contract: contractId });
      if (!payment) throw new AppError("Payment not found.", 404);

      // Verify the payment is in a state that can be released
      if (payment.status !== "requires_capture")
        throw new AppError(
          `Payment cannot be released in current status: ${payment.status}`,
          400
        );

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

      return {
        paymentIntent,
        message: "Payment released successfully"
      };
    } catch (error) {
      logger.error('Error releasing Stripe payment:', error);
      throw error;
    }
  }

  /**
   * Process withdrawal via Stripe
   */
  async processWithdrawal(userId, amount) {
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

        logger.debug(`[DEV MODE] Withdrawal check for user ${userId}:
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
        
        logger.debug(`[DEV MODE] Simulated withdrawal:
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

      return {
        payoutId: payout.id,
        amount: amount,
        status: payout.status,
        estimatedArrival: payout.arrival_date ? new Date(payout.arrival_date * 1000) : null,
      };
    } catch (error) {
      logger.error(`Error processing withdrawal for user ${userId}:`, error);
      
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

      throw new AppError(`Failed to process withdrawal request: ${error.message}`, 500);
    }
  }

  /**
   * Get payment intent for a contract
   */
  async getPaymentIntentForContract(contractId) {
    try {
      // Retrieve the payment intent from the database or payment provider (e.g., Stripe)
      const payment = await Payment.findOne({ contract: contractId });
      
      if (!payment) {
        throw new AppError("Payment not found for this contract.", 404);
      }

      let paymentIntent;
      if (payment.stripePaymentIntentId) {
        paymentIntent = await stripe.paymentIntents.retrieve(
          payment.stripePaymentIntentId
        );
      }

      if (!paymentIntent) {
        throw new AppError("Payment intent not found for this contract.", 404);
      }

      return {
        paymentIntent,
        payment,
      };
    } catch (error) {
      logger.error('Error getting Stripe payment intent:', error);
      throw error;
    }
  }

  /**
   * Refund a payment for a contract
   */
  async refundPaymentForContract(contractId, userId) {
    try {
      // Validate contract ID
      if (!mongoose.Types.ObjectId.isValid(contractId))
        throw new AppError("Invalid Contract ID format.", 400);

      // Fetch contract and payment
      const contract = await Contract.findById(contractId);
      if (!contract) throw new AppError("Contract not found", 404);

      // Check permissions - only admin or provider who owns the contract can refund
      if (!(userId === contract.provider._id.toString() || 
            (await User.findById(userId)).role.includes('admin'))) {
        throw new AppError("Not authorized to refund this payment.", 403);
      }

      // Find the payment record
      const payment = await Payment.findOne({ contract: contractId });
      if (!payment) throw new AppError("Payment record not found", 404);

      // Verify the payment is in a state that can be refunded
      if (!["succeeded", "requires_capture"].includes(payment.status))
        throw new AppError(`Payment cannot be refunded in current status: ${payment.status}`, 400);

      try {
        // Create the refund via Stripe
        const refund = await stripe.refunds.create({
          payment_intent: payment.stripePaymentIntentId,
        });

        logger.info(
          `Stripe Refund created: ${refund.id}, Status: ${refund.status}`
        );

        // Update payment and contract status
        payment.status = refund.status === "succeeded" ? "canceled" : "canceling";
        payment.stripeRefundId = refund.id;
        await payment.save();
        contract.status = "cancelled";
        await contract.save();

        return {
          refundId: refund.id,
          message: "Refund initiated successfully.",
        };
      } catch (error) {
        logger.error(
          `Error creating Stripe Refund for PaymentIntent ${payment.stripePaymentIntentId}:`,
          error
        );
        throw new AppError(`Failed to initiate refund: ${error.message}.`, 500);
      }
    } catch (error) {
      logger.error('Error refunding Stripe payment:', error);
      throw error;
    }
  }

  /**
   * Get user's payment history
   */
  async getPaymentHistory(userId, role, page = 1, limit = 10) {
    try {
      // Build query based on user role
      let query = {};
      
      if (role === 'tasker') {
        query.payee = new mongoose.Types.ObjectId(userId);
        query.type = 'payment';
      } else if (role === 'provider') {
        query.payer = new mongoose.Types.ObjectId(userId);
        query.type = 'payment';
      } else {
        // Admin can see all payments
        query = {};
      }

      // Get total count
      const totalItems = await Payment.countDocuments(query);
      const totalPages = Math.ceil(totalItems / limit);

      // Get payments with pagination
      const payments = await Payment.find(query)
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
      logger.error('Error getting Stripe payment history:', error);
      throw new AppError("Failed to retrieve payment history.", 500);
    }
  }

  /**
   * Get user's earnings summary
   */
  async getEarningsSummary(userId, role) {
    try {
      let summary = {};

      if (role.includes('tasker')) {
        // For Taskers - Money they've earned
        const taskerPayments = await Payment.aggregate([
          {
            $match: {
              payee: new mongoose.Types.ObjectId(userId),
              status: 'succeeded',
              type: 'payment'
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
              status: 'succeeded'
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
        };
      }

      if (role.includes('provider')) {
        // For Providers - Money they've spent
        const providerPayments = await Payment.aggregate([
          {
            $match: {
              payer: new mongoose.Types.ObjectId(userId),
              status: 'succeeded',
              type: 'payment'
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

      return summary;
    } catch (error) {
      logger.error('Error getting Stripe earnings summary:', error);
      throw new AppError("Failed to retrieve earnings summary.", 500);
    }
  }

  /**
   * Confirm payment success from frontend
   */
  async confirmPaymentSuccess(paymentIntentId) {
    try {
      if (!paymentIntentId) {
        throw new AppError('Payment Intent ID is required', 400);
      }

      // Verify the payment intent with Stripe
      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

      if (paymentIntent.status !== 'succeeded') {
        throw new AppError('Payment has not succeeded yet', 400);
      }

      // Find the payment record
      const payment = await Payment.findOne({
        stripePaymentIntentId: paymentIntentId,
      }).populate('contract');

      if (!payment) {
        throw new AppError('Payment record not found', 404);
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

      return {
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
      };
    } catch (error) {
      logger.error('Error confirming Stripe payment success:', error);
      throw new AppError('Failed to confirm payment success', 500);
    }
  }

  /**
   * Check if a contract is releasable
   */
  async checkIfContractIsReleasable(contractId) {
    try {
      // Retrieve the payment record from the database
      const payment = await Payment.findOne({ contract: contractId }).populate(
        "payee"
      );

      if (!payment) {
        throw new AppError("Payment not found for this contract.", 404);
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

      return {
        isReleasable,
        isPayoutReady,
        isBalanceSufficient,
        payoutAvailable: (payoutAvailable / 100).toFixed(2),
        requiredAmount: (payment.amountReceivedByPayee / 100).toFixed(2),
        currency: payment.currency.toUpperCase(),
      };
    } catch (error) {
      logger.error('Error checking if contract is releasable:', error);
      throw error;
    }
  }

  // --- Process Withdrawal via Stripe (Independent Payout Flow) ---
  async processStripeWithdrawal(userId, amount) {
    try {
      // Validate amount
      if (!amount || amount <= 0) {
        throw new AppError("Valid withdrawal amount is required.", 400);
      }

      // Get user with Stripe account ID
      const user = await User.findById(userId).select("+stripeAccountId");
      if (!user || !user.stripeAccountId)
        throw new AppError("Stripe account not connected. Please complete onboarding first.", 400);

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
          - Total received: ${(totalReceived / 100).toFixed(2)}
          - Total withdrawn: ${(totalWithdrawn / 100).toFixed(2)}
          - Available: ${(availableAmount / 100).toFixed(2)}
          - Requested: ${amount}`);

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
          - Amount: ${amount}
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
        payee: userId, // User receiving (same user for withdrawals)
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
      logger.error('Error processing Stripe withdrawal:', error);
      
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

  // --- Get User's Stripe Withdrawal History ---
  async getUserStripeWithdrawals(userId, page = 1, limit = 10) {
    try {
      // Build query filter
      const query = {
        payer: new mongoose.Types.ObjectId(userId),
        type: 'withdrawal',
        status: { $in: ['paid', 'succeeded'] }
      };

      // Get total count
      const totalItems = await Payment.countDocuments(query);
      const totalPages = Math.ceil(totalItems / limit);

      // Get withdrawals with pagination
      const withdrawals = await Payment.find(query)
        .populate('contract', 'gig status')
        .populate('gig', 'title')
        .populate('payer', 'firstName lastName email')
        .populate('payee', 'firstName lastName email')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit));

      // Format withdrawals for response
      const formattedWithdrawals = withdrawals.map(withdrawal => ({
        _id: withdrawal._id,
        id: withdrawal._id,
        type: withdrawal.type,
        status: withdrawal.status,
        amount: withdrawal.amount / 100, // Convert from cents to dollars
        amountFormatted: (withdrawal.amount / 100).toFixed(2),
        amountReceivedByPayee: withdrawal.amountReceivedByPayee,
        amountReceivedFormatted: (withdrawal.amountReceivedByPayee / 100).toFixed(2),
        totalProviderPayment: withdrawal.totalProviderPayment,
        totalProviderPaymentFormatted: (withdrawal.totalProviderPayment / 100).toFixed(2),
        applicationFeeAmount: withdrawal.applicationFeeAmount,
        applicationFeeFormatted: (withdrawal.applicationFeeAmount / 100).toFixed(2),
        taxAmount: withdrawal.taxAmount,
        taxAmountFormatted: (withdrawal.taxAmount / 100).toFixed(2),
        currency: withdrawal.currency.toUpperCase(),
        description: withdrawal.description,
        createdAt: withdrawal.createdAt,
        succeededAt: withdrawal.succeededAt,
        contract: withdrawal.contract,
        gig: withdrawal.gig,
        payer: withdrawal.payer,
        payee: withdrawal.payee,
        paymentProvider: 'stripe',
        stripePayoutId: withdrawal.stripePayoutId,
        stripeConnectedAccountId: withdrawal.stripeConnectedAccountId,
        // Determine user's role in this withdrawal
        userRole: withdrawal.payer._id.toString() === userId ? 'payer' : 'payee'
      }));

      return {
        withdrawals: formattedWithdrawals,
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalItems,
          itemsPerPage: parseInt(limit)
        }
      };
    } catch (error) {
      logger.error('Error getting user Stripe withdrawals:', error);
      throw new AppError('Failed to retrieve Stripe withdrawal history.', 500);
    }
  }

  // --- Get Stripe Available Balance ---
  async getStripeAvailableBalance(userId) {
    try {
      // Get user with Stripe account ID
      const user = await User.findById(userId).select("+stripeAccountId");
      
      if (!user || !user.stripeAccountId) {
        return 0; // No Stripe account connected
      }

      let availableAmount = 0; // Move this outside the try block

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

        logger.debug(`[DEV MODE] Stripe available balance for user ${userId}:
          - Total received: ${(totalReceived / 100).toFixed(2)}
          - Total withdrawn: ${(totalWithdrawn / 100).toFixed(2)}
          - Available: ${(availableAmount / 100).toFixed(2)}`);

      } else {
        // In production mode, get real balance from Stripe
        const balance = await stripe.balance.retrieve({
          stripeAccount: user.stripeAccountId,
        });

        const available = balance.available.find(b => b.currency === 'usd');
        availableAmount = available ? available.amount : 0;
      }

      return availableAmount;
    } catch (error) {
      logger.error('Error getting Stripe available balance:', error);
      throw new AppError('Failed to retrieve Stripe available balance', 500);
    }
  }
}

export default new StripePaymentService();