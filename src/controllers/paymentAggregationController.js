import catchAsync from '../utils/catchAsync.js';
import AppError from '../utils/AppError.js';
import aggregatedPaymentService from '../services/payment/AggregatedPaymentService.js';

// Get unified payment history from both Stripe and Nuvei
export const getUnifiedPaymentHistory = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const {
    page = 1,
    limit = 10,
    type = 'all',
    status = 'all',
    startDate,
    endDate,
    paymentProvider = 'all'
  } = req.query;

  try {
    const result = await aggregatedPaymentService.getUnifiedPaymentHistory(userId, {
      page: parseInt(page),
      limit: parseInt(limit),
      type,
      status,
      startDate,
      endDate,
      paymentProvider
    });

    res.status(200).json({
      status: 'success',
      data: result
    });
  } catch (error) {
    return next(new AppError(`Failed to get unified payment history: ${error.message}`, 500));
  }
});

// Get consolidated earnings summary from both Stripe and Nuvei
export const getConsolidatedEarningsSummary = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const { period = 'all', startDate, endDate } = req.query;

  try {
    const result = await aggregatedPaymentService.getConsolidatedEarningsSummary(
      userId,
      period,
      startDate,
      endDate
    );

    res.status(200).json({
      status: 'success',
      data: {
        summary: result.summary, // Extract the summary property from the result
        period: result.period,
        currencies: result.currencies
      }
    });
  } catch (error) {
    return next(new AppError(`Failed to get consolidated earnings summary: ${error.message}`, 500));
  }
});

// Get payment statistics across both systems
export const getPaymentStatistics = catchAsync(async (req, res, next) => {
  const userId = req.user.id;

  try {
    const result = await aggregatedPaymentService.getPaymentStatistics(userId);

    res.status(200).json({
      status: 'success',
      data: result
    });
  } catch (error) {
    return next(new AppError(`Failed to get payment statistics: ${error.message}`, 500));
  }
});

// Get cross-system payment details
export const getCrossSystemPaymentDetails = catchAsync(async (req, res, next) => {
  const { paymentId, system } = req.params; // system is 'stripe' or 'nuvei'
  
  if (!['stripe', 'nuvei'].includes(system)) {
    return next(new AppError('Invalid payment system specified. Use "stripe" or "nuvei".', 400));
  }

  try {
    let payment;
    if (system === 'stripe') {
      payment = await import('../../models/Payment.js');
      payment = await payment.default.findById(paymentId)
        .populate('contract', 'gig status')
        .populate('gig', 'title')
        .populate('payer', 'firstName lastName email')
        .populate('payee', 'firstName lastName email');
    } else {
      payment = await import('../../models/NuveiPayment.js');
      payment = await payment.default.findById(paymentId)
        .populate('contract', 'gig status')
        .populate('gig', 'title')
        .populate('payer', 'firstName lastName email')
        .populate('payee', 'firstName lastName email');
    }

    if (!payment) {
      return next(new AppError(`Payment not found in ${system} system`, 404));
    }

    // Check authorization
    const currentUserId = req.user.id;
    if (![payment.payer._id?.toString(), payment.payee._id?.toString()].includes(currentUserId) && 
        !req.user.role.includes('admin')) {
      return next(new AppError('Not authorized to access this payment', 403));
    }

    res.status(200).json({
      status: 'success',
      data: {
        payment: aggregatedPaymentService.formatPaymentData(payment, system),
        system
      }
    });
  } catch (error) {
    return next(new AppError(`Failed to get ${system} payment details: ${error.message}`, 500));
  }
});