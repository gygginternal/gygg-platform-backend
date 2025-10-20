import Payment from '../../models/Payment.js';
import NuveiPayment from '../../models/NuveiPayment.js';
import mongoose from 'mongoose';
import logger from '../../utils/logger.js';

class AggregatedPaymentService {
  // Helper function to format payment data from both systems consistently
  formatPaymentData(payment, systemType) {
    const isNuvei = systemType === 'nuvei';
    const basePayment = isNuvei ? payment.toObject() : payment._doc || payment;
    
    return {
      _id: basePayment._id,
      id: basePayment._id,
      type: basePayment.type || 'payment',
      status: basePayment.status,
      amount: basePayment.amount,
      amountFormatted: (basePayment.amount / 100).toFixed(2),
      amountReceivedByPayee: basePayment.amountReceivedByPayee || 0,
      amountReceivedFormatted: ((basePayment.amountReceivedByPayee || 0) / 100).toFixed(2),
      totalProviderPayment: basePayment.totalProviderPayment || basePayment.amount,
      totalProviderPaymentFormatted: ((basePayment.totalProviderPayment || basePayment.amount) / 100).toFixed(2),
      applicationFeeAmount: basePayment.applicationFeeAmount || 0,
      applicationFeeFormatted: ((basePayment.applicationFeeAmount || 0) / 100).toFixed(2),
      taxAmount: basePayment.taxAmount || 0,
      taxAmountFormatted: ((basePayment.taxAmount || 0) / 100).toFixed(2),
      currency: (basePayment.currency || 'USD').toUpperCase(),
      description: basePayment.description || '',
      createdAt: basePayment.createdAt,
      succeededAt: basePayment.succeededAt,
      contract: basePayment.contract,
      gig: basePayment.gig,
      payer: basePayment.payer,
      payee: basePayment.payee,
      paymentProvider: systemType,
      // Nuvei-specific fields
      nuveiTransactionId: isNuvei ? basePayment.nuveiTransactionId : null,
      nuveiSessionId: isNuvei ? basePayment.nuveiSessionId : null,
      nuveiPaymentMethod: isNuvei ? basePayment.paymentMethodType : null,
      // Stripe-specific fields
      stripePaymentIntentId: !isNuvei ? basePayment.stripePaymentIntentId : null,
      stripeChargeId: !isNuvei ? basePayment.stripeChargeId : null,
      // Determine user's role in this payment
      userRole: basePayment.payer && typeof basePayment.payer === 'object' 
        ? (basePayment.payer._id?.toString() === basePayment.payer?._id?.toString() 
            ? 'payer' : 'payee') 
        : (basePayment.payer?.toString() === this.currentUserId ? 'payer' : 'payee')
    };
  }

  // Get unified payment history from both systems
  async getUnifiedPaymentHistory(userId, options = {}) {
    try {
      const {
        page = 1,
        limit = 10,
        type = 'all', // 'earned', 'spent', 'withdrawals', 'all'
        status = 'all',
        startDate,
        endDate,
        paymentProvider = 'all' // 'stripe', 'nuvei', 'all'
      } = options;

      // Build date filter
      const dateFilter = {};
      if (startDate && endDate) {
        dateFilter.createdAt = {
          $gte: new Date(startDate),
          $lte: new Date(endDate)
        };
      }

      // Status filter
      const statusFilter = status !== 'all' ? { status } : {};

      // Build queries for each system based on user role and type
      let stripeQueries = [];
      let nuveiQueries = [];

      // Stripe Payment Queries
      if (paymentProvider === 'all' || paymentProvider === 'stripe') {
        const stripeMatchFilters = { ...dateFilter, ...statusFilter };

        if (type === 'all' || type === 'earned') {
          stripeQueries.push({
            ...stripeMatchFilters,
            payee: new mongoose.Types.ObjectId(userId),
            type: 'payment'
          });
        }

        if (type === 'all' || type === 'spent') {
          stripeQueries.push({
            ...stripeMatchFilters,
            payer: new mongoose.Types.ObjectId(userId),
            type: 'payment'
          });
        }

        if (type === 'all' || type === 'withdrawals') {
          stripeQueries.push({
            ...stripeMatchFilters,
            payer: new mongoose.Types.ObjectId(userId),
            type: 'withdrawal'
          });
        }
      }

      // Nuvei Payment Queries  
      if (paymentProvider === 'all' || paymentProvider === 'nuvei') {
        const nuveiMatchFilters = { ...dateFilter, ...statusFilter };

        if (type === 'all' || type === 'earned') {
          nuveiQueries.push({
            ...nuveiMatchFilters,
            payee: new mongoose.Types.ObjectId(userId),
            type: 'payment'
          });
        }

        if (type === 'all' || type === 'spent') {
          nuveiQueries.push({
            ...nuveiMatchFilters,
            payer: new mongoose.Types.ObjectId(userId),
            type: 'payment'
          });
        }

        if (type === 'all' || type === 'withdrawals') {
          nuveiQueries.push({
            ...nuveiMatchFilters,
            payer: new mongoose.Types.ObjectId(userId),
            type: 'withdrawal'
          });
        }
      }

      // Execute queries in parallel
      const [stripePayments, nuveiPayments] = await Promise.all([
        stripeQueries.length > 0
          ? Payment.find({
              $or: stripeQueries
            })
            .populate('contract', 'gig status')
            .populate('gig', 'title')
            .populate('payer', 'firstName lastName email')
            .populate('payee', 'firstName lastName email')
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(parseInt(limit) * 2) // Fetch more to allow for sorting later
          : Promise.resolve([]),
        
        nuveiQueries.length > 0
          ? NuveiPayment.find({
              $or: nuveiQueries
            })
            .populate('contract', 'gig status')
            .populate('gig', 'title')
            .populate('payer', 'firstName lastName email')
            .populate('payee', 'firstName lastName email')
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(parseInt(limit) * 2) // Fetch more to allow for sorting later
          : Promise.resolve([])
      ]);

      // Format all payments consistently
      const formattedStripePayments = stripePayments.map(payment => 
        this.formatPaymentData(payment, 'stripe')
      );
      
      const formattedNuveiPayments = nuveiPayments.map(payment => 
        this.formatPaymentData(payment, 'nuvei')
      );

      // Combine and sort all payments by date (newest first)
      const allPayments = [
        ...formattedStripePayments,
        ...formattedNuveiPayments
      ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      // Apply pagination to combined results
      const startIndex = (page - 1) * limit;
      const paginatedPayments = allPayments.slice(startIndex, startIndex + limit);

      // Get total counts for consistent pagination
      const [totalStripeCount, totalNuveiCount] = await Promise.all([
        stripeQueries.length > 0 
          ? Payment.countDocuments({ $or: stripeQueries })
          : Promise.resolve(0),
        nuveiQueries.length > 0
          ? NuveiPayment.countDocuments({ $or: nuveiQueries })
          : Promise.resolve(0)
      ]);

      const totalItems = totalStripeCount + totalNuveiCount;
      const totalPages = Math.ceil(totalItems / limit);

      return {
        payments: paginatedPayments,
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalItems,
          itemsPerPage: parseInt(limit)
        },
        systemBreakdown: {
          stripe: {
            count: totalStripeCount,
            currency: 'USD' // Default for Stripe
          },
          nuvei: {
            count: totalNuveiCount,
            currency: 'CAD' // Default for Nuvei
          }
        }
      };
    } catch (error) {
      logger.error('Error getting unified payment history:', error);
      throw error;
    }
  }

  // Get consolidated earnings summary from both systems
  async getConsolidatedEarningsSummary(userId, period = 'all', startDate, endDate) {
    try {
      // Build date filter
      const dateFilter = {};
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

      // Get Stripe earnings summary
      const [
        stripeTaskerPayments, stripeTaskerWithdrawals,
        stripeProviderPayments
      ] = await Promise.all([
        // Tasker earnings from Stripe
        Payment.aggregate([
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
        ]),
        
        // Tasker withdrawals from Stripe
        Payment.aggregate([
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
        ]),
        
        // Provider spending from Stripe
        Payment.aggregate([
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
        ])
      ]);

      // Get Nuvei earnings summary
      const [
        nuveiTaskerPayments, nuveiTaskerWithdrawals,
        nuveiProviderPayments
      ] = await Promise.all([
        // Tasker earnings from Nuvei
        NuveiPayment.aggregate([
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
        ]),
        
        // Tasker withdrawals from Nuvei
        NuveiPayment.aggregate([
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
        ]),
        
        // Provider spending from Nuvei
        NuveiPayment.aggregate([
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
        ])
      ]);

      // Consolidate the results
      const consolidatedSummary = {
        period,
        currency: 'mixed', // Since we have CAD and USD
        breakdown: {
          stripe: {
            tasker: {
              totalEarned: stripeTaskerPayments[0]?.totalEarned || 0,
              totalEarnedFormatted: ((stripeTaskerPayments[0]?.totalEarned || 0) / 100).toFixed(2),
              totalContracts: stripeTaskerPayments[0]?.totalContracts || 0,
              totalTaxesPaid: stripeTaskerPayments[0]?.totalTaxesPaid || 0,
              totalTaxesPaidFormatted: ((stripeTaskerPayments[0]?.totalTaxesPaid || 0) / 100).toFixed(2),
              averageEarning: stripeTaskerPayments[0]?.averageEarning || 0,
              averageEarningFormatted: ((stripeTaskerPayments[0]?.averageEarning || 0) / 100).toFixed(2),
              totalWithdrawn: stripeTaskerWithdrawals[0]?.totalWithdrawn || 0,
              totalWithdrawnFormatted: ((stripeTaskerWithdrawals[0]?.totalWithdrawn || 0) / 100).toFixed(2),
              withdrawalCount: stripeTaskerWithdrawals[0]?.withdrawalCount || 0,
            },
            provider: {
              totalSpent: stripeProviderPayments[0]?.totalSpent || 0,
              totalSpentFormatted: ((stripeProviderPayments[0]?.totalSpent || 0) / 100).toFixed(2),
              totalServiceCosts: stripeProviderPayments[0]?.totalServiceCosts || 0,
              totalServiceCostsFormatted: ((stripeProviderPayments[0]?.totalServiceCosts || 0) / 100).toFixed(2),
              totalPlatformFees: stripeProviderPayments[0]?.totalPlatformFees || 0,
              totalPlatformFeesFormatted: ((stripeProviderPayments[0]?.totalPlatformFees || 0) / 100).toFixed(2),
              totalTaxesPaid: stripeProviderPayments[0]?.totalTaxesPaid || 0,
              totalTaxesPaidFormatted: ((stripeProviderPayments[0]?.totalTaxesPaid || 0) / 100).toFixed(2),
              totalContracts: stripeProviderPayments[0]?.totalContracts || 0,
              averageSpent: stripeProviderPayments[0]?.averageSpent || 0,
              averageSpentFormatted: ((stripeProviderPayments[0]?.averageSpent || 0) / 100).toFixed(2)
            }
          },
          nuvei: {
            tasker: {
              totalEarned: nuveiTaskerPayments[0]?.totalEarned || 0,
              totalEarnedFormatted: ((nuveiTaskerPayments[0]?.totalEarned || 0) / 100).toFixed(2),
              totalContracts: nuveiTaskerPayments[0]?.totalContracts || 0,
              totalTaxesPaid: nuveiTaskerPayments[0]?.totalTaxesPaid || 0,
              totalTaxesPaidFormatted: ((nuveiTaskerPayments[0]?.totalTaxesPaid || 0) / 100).toFixed(2),
              averageEarning: nuveiTaskerPayments[0]?.averageEarning || 0,
              averageEarningFormatted: ((nuveiTaskerPayments[0]?.averageEarning || 0) / 100).toFixed(2),
              totalWithdrawn: nuveiTaskerWithdrawals[0]?.totalWithdrawn || 0,
              totalWithdrawnFormatted: ((nuveiTaskerWithdrawals[0]?.totalWithdrawn || 0) / 100).toFixed(2),
              withdrawalCount: nuveiTaskerWithdrawals[0]?.withdrawalCount || 0,
            },
            provider: {
              totalSpent: nuveiProviderPayments[0]?.totalSpent || 0,
              totalSpentFormatted: ((nuveiProviderPayments[0]?.totalSpent || 0) / 100).toFixed(2),
              totalServiceCosts: nuveiProviderPayments[0]?.totalServiceCosts || 0,
              totalServiceCostsFormatted: ((nuveiProviderPayments[0]?.totalServiceCosts || 0) / 100).toFixed(2),
              totalPlatformFees: nuveiProviderPayments[0]?.totalPlatformFees || 0,
              totalPlatformFeesFormatted: ((nuveiProviderPayments[0]?.totalPlatformFees || 0) / 100).toFixed(2),
              totalTaxesPaid: nuveiProviderPayments[0]?.totalTaxesPaid || 0,
              totalTaxesPaidFormatted: ((nuveiProviderPayments[0]?.totalTaxesPaid || 0) / 100).toFixed(2),
              totalContracts: nuveiProviderPayments[0]?.totalContracts || 0,
              averageSpent: nuveiProviderPayments[0]?.averageSpent || 0,
              averageSpentFormatted: ((nuveiProviderPayments[0]?.averageSpent || 0) / 100).toFixed(2)
            }
          }
        },
        consolidated: {
          tasker: {
            totalEarned: (stripeTaskerPayments[0]?.totalEarned || 0) + (nuveiTaskerPayments[0]?.totalEarned || 0),
            totalEarnedFormatted: (((stripeTaskerPayments[0]?.totalEarned || 0) + (nuveiTaskerPayments[0]?.totalEarned || 0)) / 100).toFixed(2),
            totalContracts: (stripeTaskerPayments[0]?.totalContracts || 0) + (nuveiTaskerPayments[0]?.totalContracts || 0),
            totalTaxesPaid: (stripeTaskerPayments[0]?.totalTaxesPaid || 0) + (nuveiTaskerPayments[0]?.totalTaxesPaid || 0),
            totalTaxesPaidFormatted: (((stripeTaskerPayments[0]?.totalTaxesPaid || 0) + (nuveiTaskerPayments[0]?.totalTaxesPaid || 0)) / 100).toFixed(2),
            averageEarning: ((stripeTaskerPayments[0]?.totalEarned || 0) + (nuveiTaskerPayments[0]?.totalEarned || 0)) / 
                           ((stripeTaskerPayments[0]?.totalContracts || 0) + (nuveiTaskerPayments[0]?.totalContracts || 0) || 1),
            averageEarningFormatted: ((((stripeTaskerPayments[0]?.totalEarned || 0) + (nuveiTaskerPayments[0]?.totalEarned || 0)) / 
                           ((stripeTaskerPayments[0]?.totalContracts || 0) + (nuveiTaskerPayments[0]?.totalContracts || 0) || 1)) / 100).toFixed(2),
            totalWithdrawn: (stripeTaskerWithdrawals[0]?.totalWithdrawn || 0) + (nuveiTaskerWithdrawals[0]?.totalWithdrawn || 0),
            totalWithdrawnFormatted: (((stripeTaskerWithdrawals[0]?.totalWithdrawn || 0) + (nuveiTaskerWithdrawals[0]?.totalWithdrawn || 0)) / 100).toFixed(2),
            withdrawalCount: (stripeTaskerWithdrawals[0]?.withdrawalCount || 0) + (nuveiTaskerWithdrawals[0]?.withdrawalCount || 0),
          },
          provider: {
            totalSpent: (stripeProviderPayments[0]?.totalSpent || 0) + (nuveiProviderPayments[0]?.totalSpent || 0),
            totalSpentFormatted: (((stripeProviderPayments[0]?.totalSpent || 0) + (nuveiProviderPayments[0]?.totalSpent || 0)) / 100).toFixed(2),
            totalServiceCosts: (stripeProviderPayments[0]?.totalServiceCosts || 0) + (nuveiProviderPayments[0]?.totalServiceCosts || 0),
            totalServiceCostsFormatted: (((stripeProviderPayments[0]?.totalServiceCosts || 0) + (nuveiProviderPayments[0]?.totalServiceCosts || 0)) / 100).toFixed(2),
            totalPlatformFees: (stripeProviderPayments[0]?.totalPlatformFees || 0) + (nuveiProviderPayments[0]?.totalPlatformFees || 0),
            totalPlatformFeesFormatted: (((stripeProviderPayments[0]?.totalPlatformFees || 0) + (nuveiProviderPayments[0]?.totalPlatformFees || 0)) / 100).toFixed(2),
            totalTaxesPaid: (stripeProviderPayments[0]?.totalTaxesPaid || 0) + (nuveiProviderPayments[0]?.totalTaxesPaid || 0),
            totalTaxesPaidFormatted: (((stripeProviderPayments[0]?.totalTaxesPaid || 0) + (nuveiProviderPayments[0]?.totalTaxesPaid || 0)) / 100).toFixed(2),
            totalContracts: (stripeProviderPayments[0]?.totalContracts || 0) + (nuveiProviderPayments[0]?.totalContracts || 0),
            averageSpent: ((stripeProviderPayments[0]?.totalSpent || 0) + (nuveiProviderPayments[0]?.totalSpent || 0)) / 
                          ((stripeProviderPayments[0]?.totalContracts || 0) + (nuveiProviderPayments[0]?.totalContracts || 0) || 1),
            averageSpentFormatted: ((((stripeProviderPayments[0]?.totalSpent || 0) + (nuveiProviderPayments[0]?.totalSpent || 0)) / 
                          ((stripeProviderPayments[0]?.totalContracts || 0) + (nuveiProviderPayments[0]?.totalContracts || 0) || 1)) / 100).toFixed(2)
          }
        }
      };

      return {
        period,
        consolidatedSummary,
        currencies: ['USD', 'CAD'] // Mixed currencies from both systems
      };
    } catch (error) {
      logger.error('Error getting consolidated earnings summary:', error);
      throw error;
    }
  }

  // Get payment statistics across both systems
  async getPaymentStatistics(userId) {
    try {
      const [stripeStats, nuveiStats] = await Promise.all([
        Payment.aggregate([
          {
            $match: {
              $or: [
                { payer: new mongoose.Types.ObjectId(userId) },
                { payee: new mongoose.Types.ObjectId(userId) }
              ]
            }
          },
          {
            $group: {
              _id: '$status',
              count: { $sum: 1 },
              totalAmount: { $sum: '$amount' }
            }
          }
        ]),
        NuveiPayment.aggregate([
          {
            $match: {
              $or: [
                { payer: new mongoose.Types.ObjectId(userId) },
                { payee: new mongoose.Types.ObjectId(userId) }
              ]
            }
          },
          {
            $group: {
              _id: '$status',
              count: { $sum: 1 },
              totalAmount: { $sum: '$amount' }
            }
          }
        ])
      ]);

      const stripeStatsMap = stripeStats.reduce((acc, stat) => {
        acc[stat._id] = { count: stat.count, totalAmount: stat.totalAmount };
        return acc;
      }, {});

      const nuveiStatsMap = nuveiStats.reduce((acc, stat) => {
        acc[stat._id] = { count: stat.count, totalAmount: stat.totalAmount };
        return acc;
      }, {});

      return {
        bySystem: {
          stripe: stripeStatsMap,
          nuvei: nuveiStatsMap
        },
        consolidated: {
          ...this.mergeStats([stripeStatsMap, nuveiStatsMap])
        }
      };
    } catch (error) {
      logger.error('Error getting payment statistics:', error);
      throw error;
    }
  }

  // Get user's payment methods from both systems
  async getUserPaymentMethods(userId) {
    try {
      const user = await import('../../models/User.js');
      const User = user.default;
      
      const userData = await User.findById(userId).select(
        '+stripeAccountId +nuveiAccountId +nuveiBankToken +nuveiPaymentMethods'
      );
      
      if (!userData) {
        throw new Error('User not found');
      }

      const methods = {
        stripe: {
          connected: !!userData.stripeAccountId,
          accountId: userData.stripeAccountId,
          chargesEnabled: userData.stripeChargesEnabled,
          payoutsEnabled: userData.stripePayoutsEnabled,
          customerId: userData.stripeCustomerId,
          default: userData.defaultPaymentMethod === 'stripe'
        },
        nuvei: {
          connected: !!userData.nuveiAccountId,
          accountId: userData.nuveiAccountId,
          customerId: userData.nuveiCustomerId,
          bankTransferEnabled: userData.nuveiBankTransferEnabled,
          bankDetails: userData.nuveiBankDetails,
          paymentMethods: userData.nuveiPaymentMethods,
          default: userData.defaultPaymentMethod === 'nuvei'
        },
        defaultMethod: userData.defaultPaymentMethod || 'stripe'
      };

      return {
        methods,
        message: "Payment methods retrieved successfully"
      };
    } catch (error) {
      logger.error('Error getting user payment methods:', error);
      throw new Error(`Failed to get payment methods: ${error.message}`);
    }
  }

  // Get monthly earnings trends for both systems
  async getMonthlyEarningsTrends(userId, months = 12) {
    try {
      const Payment = (await import('../../models/Payment.js')).default;
      const NuveiPayment = (await import('../../models/NuveiPayment.js')).default;
      
      // Calculate date range
      const endDate = new Date();
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - months);

      // Get Stripe monthly earnings
      const stripeMonthlyData = await Payment.aggregate([
        {
          $match: {
            payee: new mongoose.Types.ObjectId(userId),
            status: 'succeeded',
            type: 'payment',
            createdAt: {
              $gte: startDate,
              $lte: endDate
            }
          }
        },
        {
          $group: {
            _id: {
              year: { $year: "$createdAt" },
              month: { $month: "$createdAt" }
            },
            totalEarned: { $sum: '$amountReceivedByPayee' },
            totalTransactions: { $sum: 1 },
            averageEarning: { $avg: '$amountReceivedByPayee' }
          }
        },
        {
          $sort: {
            "_id.year": 1,
            "_id.month": 1
          }
        }
      ]);

      // Get Nuvei monthly earnings
      const nuveiMonthlyData = await NuveiPayment.aggregate([
        {
          $match: {
            payee: new mongoose.Types.ObjectId(userId),
            status: 'succeeded',
            type: 'payment',
            createdAt: {
              $gte: startDate,
              $lte: endDate
            }
          }
        },
        {
          $group: {
            _id: {
              year: { $year: "$createdAt" },
              month: { $month: "$createdAt" }
            },
            totalEarned: { $sum: '$amountReceivedByPayee' },
            totalTransactions: { $sum: 1 },
            averageEarning: { $avg: '$amountReceivedByPayee' }
          }
        },
        {
          $sort: {
            "_id.year": 1,
            "_id.month": 1
          }
        }
      ]);

      // Format the data for the chart
      const monthlyTrends = {
        period: months,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        stripe: stripeMonthlyData.map(item => ({
          year: item._id.year,
          month: item._id.month,
          monthName: new Date(item._id.year, item._id.month - 1).toLocaleString('default', { month: 'short' }),
          totalEarned: item.totalEarned,
          totalEarnedFormatted: (item.totalEarned / 100).toFixed(2),
          totalTransactions: item.totalTransactions,
          averageEarning: item.averageEarning,
          averageEarningFormatted: (item.averageEarning / 100).toFixed(2)
        })),
        nuvei: nuveiMonthlyData.map(item => ({
          year: item._id.year,
          month: item._id.month,
          monthName: new Date(item._id.year, item._id.month - 1).toLocaleString('default', { month: 'short' }),
          totalEarned: item.totalEarned,
          totalEarnedFormatted: (item.totalEarned / 100).toFixed(2),
          totalTransactions: item.totalTransactions,
          averageEarning: item.averageEarning,
          averageEarningFormatted: (item.averageEarning / 100).toFixed(2)
        }))
      };

      return monthlyTrends;
    } catch (error) {
      logger.error('Error getting monthly earnings trends:', error);
      throw new Error(`Failed to get monthly earnings trends: ${error.message}`);
    }
  }

  // Get user's available balances across both systems
  async getAvailableBalances(userId) {
    try {
      const Payment = (await import('../../models/Payment.js')).default;
      const NuveiPayment = (await import('../../models/NuveiPayment.js')).default;
      
      // Calculate Stripe balance
      const stripePaymentsReceived = await Payment.find({
        payee: new mongoose.Types.ObjectId(userId),
        status: 'succeeded',
        type: 'payment'
      });

      const stripeWithdrawals = await Payment.find({
        payer: new mongoose.Types.ObjectId(userId),
        status: { $in: ['paid', 'succeeded'] },
        type: 'withdrawal'
      });

      const stripeTotalReceived = stripePaymentsReceived.reduce((sum, payment) => {
        return sum + (payment.amountReceivedByPayee || 0);
      }, 0);

      const stripeTotalWithdrawn = stripeWithdrawals.reduce((sum, withdrawal) => {
        return sum + (withdrawal.amount || 0);
      }, 0);

      const stripeAvailableBalance = stripeTotalReceived - stripeTotalWithdrawn;

      // Calculate Nuvei balance
      const nuveiPaymentsReceived = await NuveiPayment.find({
        payee: new mongoose.Types.ObjectId(userId),
        status: 'succeeded',
        type: 'payment'
      });

      const nuveiWithdrawals = await NuveiPayment.find({
        payer: new mongoose.Types.ObjectId(userId),
        status: { $in: ['paid', 'succeeded'] },
        type: 'withdrawal'
      });

      const nuveiTotalReceived = nuveiPaymentsReceived.reduce((sum, payment) => {
        return sum + (payment.amountReceivedByPayee || 0);
      }, 0);

      const nuveiTotalWithdrawn = nuveiWithdrawals.reduce((sum, withdrawal) => {
        return sum + (withdrawal.amount || 0);
      }, 0);

      const nuveiAvailableBalance = nuveiTotalReceived - nuveiTotalWithdrawn;

      // Consolidated balance
      const consolidatedBalance = stripeAvailableBalance + nuveiAvailableBalance;

      return {
        balances: {
          stripe: {
            available: stripeAvailableBalance,
            availableFormatted: (stripeAvailableBalance / 100).toFixed(2),
            currency: 'USD',
            paymentProvider: 'stripe'
          },
          nuvei: {
            available: nuveiAvailableBalance,
            availableFormatted: (nuveiAvailableBalance / 100).toFixed(2),
            currency: 'CAD',
            paymentProvider: 'nuvei'
          },
          consolidated: {
            available: consolidatedBalance,
            availableFormatted: ((stripeAvailableBalance / 100) + (nuveiAvailableBalance / 100)).toFixed(2),
            currencies: ['USD', 'CAD']
          }
        }
      };
    } catch (error) {
      logger.error('Error getting available balances:', error);
      throw new Error(`Failed to get available balances: ${error.message}`);
    }
  }

  // Get payment efficiency metrics
  async getPaymentEfficiencyMetrics(userId) {
    try {
      const Payment = (await import('../../models/Payment.js')).default;
      const NuveiPayment = (await import('../../models/NuveiPayment.js')).default;
      
      // Get success rates for both systems
      const stripeTotalPayments = await Payment.countDocuments({
        $or: [
          { payer: new mongoose.Types.ObjectId(userId) },
          { payee: new mongoose.Types.ObjectId(userId) }
        ],
        type: 'payment'
      });

      const stripeSuccessfulPayments = await Payment.countDocuments({
        $or: [
          { payer: new mongoose.Types.ObjectId(userId) },
          { payee: new mongoose.Types.ObjectId(userId) }
        ],
        type: 'payment',
        status: 'succeeded'
      });

      const nuveiTotalPayments = await NuveiPayment.countDocuments({
        $or: [
          { payer: new mongoose.Types.ObjectId(userId) },
          { payee: new mongoose.Types.ObjectId(userId) }
        ],
        type: 'payment'
      });

      const nuveiSuccessfulPayments = await NuveiPayment.countDocuments({
        $or: [
          { payer: new mongoose.Types.ObjectId(userId) },
          { payee: new mongoose.Types.ObjectId(userId) }
        ],
        type: 'payment',
        status: 'succeeded'
      });

      const stripeSuccessRate = stripeTotalPayments > 0 ? 
        (stripeSuccessfulPayments / stripeTotalPayments) * 100 : 0;
        
      const nuveiSuccessRate = nuveiTotalPayments > 0 ? 
        (nuveiSuccessfulPayments / nuveiTotalPayments) * 100 : 0;

      // Get average processing times
      const stripeAvgProcessingTime = await Payment.aggregate([
        {
          $match: {
            $or: [
              { payer: new mongoose.Types.ObjectId(userId) },
              { payee: new mongoose.Types.ObjectId(userId) }
            ],
            type: 'payment',
            status: 'succeeded',
            succeededAt: { $exists: true },
            createdAt: { $exists: true }
          }
        },
        {
          $project: {
            processingTime: {
              $subtract: ["$succeededAt", "$createdAt"]
            }
          }
        },
        {
          $group: {
            _id: null,
            avgProcessingTime: { $avg: "$processingTime" }
          }
        }
      ]);

      const nuveiAvgProcessingTime = await NuveiPayment.aggregate([
        {
          $match: {
            $or: [
              { payer: new mongoose.Types.ObjectId(userId) },
              { payee: new mongoose.Types.ObjectId(userId) }
            ],
            type: 'payment',
            status: 'succeeded',
            succeededAt: { $exists: true },
            createdAt: { $exists: true }
          }
        },
        {
          $project: {
            processingTime: {
              $subtract: ["$succeededAt", "$createdAt"]
            }
          }
        },
        {
          $group: {
            _id: null,
            avgProcessingTime: { $avg: "$processingTime" }
          }
        }
      ]);

      return {
        metrics: {
          stripe: {
            totalPayments: stripeTotalPayments,
            successfulPayments: stripeSuccessfulPayments,
            successRate: stripeSuccessRate,
            successRateFormatted: stripeSuccessRate.toFixed(2) + '%',
            avgProcessingTime: stripeAvgProcessingTime[0]?.avgProcessingTime || 0,
            avgProcessingTimeFormatted: stripeAvgProcessingTime[0]?.avgProcessingTime ? 
              `${Math.round(stripeAvgProcessingTime[0].avgProcessingTime / 1000 / 60)} minutes` : 'N/A'
          },
          nuvei: {
            totalPayments: nuveiTotalPayments,
            successfulPayments: nuveiSuccessfulPayments,
            successRate: nuveiSuccessRate,
            successRateFormatted: nuveiSuccessRate.toFixed(2) + '%',
            avgProcessingTime: nuveiAvgProcessingTime[0]?.avgProcessingTime || 0,
            avgProcessingTimeFormatted: nuveiAvgProcessingTime[0]?.avgProcessingTime ? 
              `${Math.round(nuveiAvgProcessingTime[0].avgProcessingTime / 1000 / 60)} minutes` : 'N/A'
          },
          consolidated: {
            totalPayments: stripeTotalPayments + nuveiTotalPayments,
            successfulPayments: stripeSuccessfulPayments + nuveiSuccessfulPayments,
            successRate: ((stripeSuccessfulPayments + nuveiSuccessfulPayments) / 
                         (stripeTotalPayments + nuveiTotalPayments || 1)) * 100,
            successRateFormatted: (((stripeSuccessfulPayments + nuveiSuccessfulPayments) / 
                                   (stripeTotalPayments + nuveiTotalPayments || 1)) * 100).toFixed(2) + '%'
          }
        }
      };
    } catch (error) {
      logger.error('Error getting payment efficiency metrics:', error);
      throw new Error(`Failed to get payment efficiency metrics: ${error.message}`);
    }
  }
}

export default new AggregatedPaymentService();