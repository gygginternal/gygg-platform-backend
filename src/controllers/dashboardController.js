import catchAsync from '../utils/catchAsync.js';
import AppError from '../utils/AppError.js';
import aggregatedPaymentService from '../services/payment/AggregatedPaymentService.js';

// Get comprehensive consolidated dashboard data
export const getConsolidatedDashboard = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const { period = 'all', startDate, endDate } = req.query;

  try {
    // Get all dashboard data in parallel
    const [
      unifiedPaymentHistory,
      consolidatedEarningsSummary,
      paymentStatistics,
      userPaymentMethods
    ] = await Promise.all([
      // Get unified payment history (recent transactions)
      aggregatedPaymentService.getUnifiedPaymentHistory(userId, {
        page: 1,
        limit: 10, // Recent 10 transactions
        type: 'all',
        status: 'all',
        paymentProvider: 'all'
      }),
      
      // Get consolidated earnings summary
      aggregatedPaymentService.getConsolidatedEarningsSummary(
        userId,
        period,
        startDate,
        endDate
      ),
      
      // Get payment statistics
      aggregatedPaymentService.getPaymentStatistics(userId),
      
      // Get user payment methods
      aggregatedPaymentService.getUserPaymentMethods(userId)
    ]);

    // Format the dashboard response
    const dashboardData = {
      period: consolidatedEarningsSummary.period,
      consolidatedSummary: consolidatedEarningsSummary.consolidatedSummary,
      recentTransactions: unifiedPaymentHistory.payments,
      transactionPagination: unifiedPaymentHistory.pagination,
      paymentStatistics: paymentStatistics.consolidated,
      systemBreakdown: unifiedPaymentHistory.systemBreakdown,
      userPaymentMethods: userPaymentMethods.methods,
      defaultPaymentMethod: userPaymentMethods.defaultMethod,
      currencies: consolidatedEarningsSummary.currencies
    };

    res.status(200).json({
      status: 'success',
      data: dashboardData
    });
  } catch (error) {
    return next(new AppError(`Failed to get consolidated dashboard: ${error.message}`, 500));
  }
});

// Get detailed payment history with advanced filtering
export const getDetailedPaymentHistory = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const {
    page = 1,
    limit = 20,
    type = 'all',
    status = 'all',
    startDate,
    endDate,
    paymentProvider = 'all',
    sortBy = 'createdAt',
    sortOrder = 'desc'
  } = req.query;

  try {
    const result = await aggregatedPaymentService.getUnifiedPaymentHistory(userId, {
      page: parseInt(page),
      limit: parseInt(limit),
      type,
      status,
      startDate,
      endDate,
      paymentProvider,
      sortBy,
      sortOrder
    });

    res.status(200).json({
      status: 'success',
      data: result
    });
  } catch (error) {
    return next(new AppError(`Failed to get detailed payment history: ${error.message}`, 500));
  }
});

// Get earnings breakdown by payment provider
export const getEarningsByProvider = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const { period = 'all', startDate, endDate } = req.query;

  try {
    const result = await aggregatedPaymentService.getConsolidatedEarningsSummary(
      userId,
      period,
      startDate,
      endDate
    );

    // Format earnings by provider
    const earningsByProvider = {
      stripe: result.breakdown.stripe,
      nuvei: result.breakdown.nuvei,
      consolidated: result.consolidated,
      period: result.period,
      currency: result.currency,
      currencies: result.currencies
    };

    res.status(200).json({
      status: 'success',
      data: earningsByProvider
    });
  } catch (error) {
    return next(new AppError(`Failed to get earnings by provider: ${error.message}`, 500));
  }
});

// Get payment method comparison data
export const getPaymentMethodComparison = catchAsync(async (req, res, next) => {
  const userId = req.user.id;

  try {
    // Get statistics for both systems
    const stats = await aggregatedPaymentService.getPaymentStatistics(userId);
    
    // Get user payment methods
    const methods = await aggregatedPaymentService.getUserPaymentMethods(userId);

    // Format comparison data
    const comparisonData = {
      systemStats: stats.bySystem,
      consolidatedStats: stats.consolidated,
      userMethods: methods.methods,
      defaultMethod: methods.defaultMethod,
      summary: {
        stripe: {
          totalTransactions: stats.bySystem.stripe ? Object.values(stats.bySystem.stripe).reduce((sum, stat) => sum + stat.count, 0) : 0,
          totalAmount: stats.bySystem.stripe ? Object.values(stats.bySystem.stripe).reduce((sum, stat) => sum + stat.totalAmount, 0) : 0,
          totalAmountFormatted: stats.bySystem.stripe ? ((Object.values(stats.bySystem.stripe).reduce((sum, stat) => sum + stat.totalAmount, 0) / 100).toFixed(2)) : '0.00'
        },
        nuvei: {
          totalTransactions: stats.bySystem.nuvei ? Object.values(stats.bySystem.nuvei).reduce((sum, stat) => sum + stat.count, 0) : 0,
          totalAmount: stats.bySystem.nuvei ? Object.values(stats.bySystem.nuvei).reduce((sum, stat) => sum + stat.totalAmount, 0) : 0,
          totalAmountFormatted: stats.bySystem.nuvei ? ((Object.values(stats.bySystem.nuvei).reduce((sum, stat) => sum + stat.totalAmount, 0) / 100).toFixed(2)) : '0.00'
        },
        consolidated: {
          totalTransactions: Object.values(stats.consolidated).reduce((sum, stat) => sum + stat.count, 0),
          totalAmount: Object.values(stats.consolidated).reduce((sum, stat) => sum + stat.totalAmount, 0),
          totalAmountFormatted: ((Object.values(stats.consolidated).reduce((sum, stat) => sum + stat.totalAmount, 0) / 100).toFixed(2))
        }
      }
    };

    res.status(200).json({
      status: 'success',
      data: comparisonData
    });
  } catch (error) {
    return next(new AppError(`Failed to get payment method comparison: ${error.message}`, 500));
  }
});

// Get monthly earnings trends
export const getMonthlyEarningsTrends = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const { months = 12 } = req.query;

  try {
    // Get monthly data for both systems
    const monthlyData = await aggregatedPaymentService.getMonthlyEarningsTrends(
      userId,
      parseInt(months)
    );

    res.status(200).json({
      status: 'success',
      data: monthlyData
    });
  } catch (error) {
    return next(new AppError(`Failed to get monthly earnings trends: ${error.message}`, 500));
  }
});

// Get user's available balances across both systems
export const getAvailableBalances = catchAsync(async (req, res, next) => {
  const userId = req.user.id;

  try {
    const balances = await aggregatedPaymentService.getAvailableBalances(userId);

    res.status(200).json({
      status: 'success',
      data: balances
    });
  } catch (error) {
    return next(new AppError(`Failed to get available balances: ${error.message}`, 500));
  }
});

// Get payment efficiency metrics
export const getPaymentEfficiencyMetrics = catchAsync(async (req, res, next) => {
  const userId = req.user.id;

  try {
    const metrics = await aggregatedPaymentService.getPaymentEfficiencyMetrics(userId);

    res.status(200).json({
      status: 'success',
      data: metrics
    });
  } catch (error) {
    return next(new AppError(`Failed to get payment efficiency metrics: ${error.message}`, 500));
  }
});