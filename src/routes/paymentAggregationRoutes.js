import express from 'express';
import { protect } from '../controllers/authController.js';
import {
  getUnifiedPaymentHistory,
  getConsolidatedEarningsSummary,
  getPaymentStatistics,
  getCrossSystemPaymentDetails
} from '../controllers/paymentAggregationController.js';

const router = express.Router();

// Protect all routes
router.use(protect);

// Unified payment history from both Stripe and Nuvei
router.get('/unified-history', getUnifiedPaymentHistory);

// Consolidated earnings summary from both systems
router.get('/consolidated-summary', getConsolidatedEarningsSummary);

// Payment statistics across both systems
router.get('/statistics', getPaymentStatistics);

// Get specific payment details from either system
router.get('/cross-system/:system/:paymentId', getCrossSystemPaymentDetails);

export default router;