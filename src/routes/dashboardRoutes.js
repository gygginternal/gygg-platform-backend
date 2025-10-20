import express from 'express';
import { protect, restrictTo } from '../controllers/authController.js';
import {
  getConsolidatedDashboard,
  getDetailedPaymentHistory,
  getEarningsByProvider,
  getPaymentMethodComparison,
  getMonthlyEarningsTrends,
  getAvailableBalances,
  getPaymentEfficiencyMetrics
} from '../controllers/dashboardController.js';

const router = express.Router();

// Protect all dashboard routes
router.use(protect);

// --- Consolidated Dashboard Routes ---

// Get comprehensive consolidated dashboard data
router.get(
  '/',
  [
    restrictTo("provider", "tasker"), // Both providers and taskers can view dashboard
  ],
  getConsolidatedDashboard
);

// Get detailed payment history with advanced filtering
router.get(
  '/payment-history',
  [
    restrictTo("provider", "tasker"), // Both can view their payment history
  ],
  getDetailedPaymentHistory
);

// Get earnings breakdown by payment provider
router.get(
  '/earnings-by-provider',
  [
    restrictTo("provider", "tasker"), // Both can view their earnings breakdown
  ],
  getEarningsByProvider
);

// Get payment method comparison data
router.get(
  '/payment-method-comparison',
  [
    restrictTo("provider", "tasker"), // Both can view comparison data
  ],
  getPaymentMethodComparison
);

// Get monthly earnings trends
router.get(
  '/monthly-trends',
  [
    restrictTo("provider", "tasker"), // Both can view trends
  ],
  getMonthlyEarningsTrends
);

// Get user's available balances across both systems
router.get(
  '/balances',
  [
    restrictTo("provider", "tasker"), // Both can check their balances
  ],
  getAvailableBalances
);

// Get payment efficiency metrics
router.get(
  '/efficiency-metrics',
  [
    restrictTo("provider", "tasker"), // Both can view efficiency metrics
  ],
  getPaymentEfficiencyMetrics
);

export default router;