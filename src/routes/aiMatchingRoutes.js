const express = require('express');
const aiMatchingController = require('../controllers/aiMatchingController');
const authController = require('../controllers/authController');
const {
  aiMatchingRateLimit,
  premiumRateLimit,
  cacheMatchingResults,
  validateMatchingRequest,
  logMatchingRequest,
  checkMatchingPermissions
} = require('../middleware/aiMatchingMiddleware');

const router = express.Router();

// Protect all routes - require authentication
router.use(authController.protect);

// Apply rate limiting
router.use(aiMatchingRateLimit);
router.use(premiumRateLimit);

// Apply common middleware
router.use(validateMatchingRequest);
router.use(logMatchingRequest);
router.use(checkMatchingPermissions);

/**
 * @route   GET /api/ai-matching/taskers/:providerId
 * @desc    Find matching taskers for a provider
 * @access  Private
 * @params  providerId - Provider's user ID
 * @query   limit - Number of results (default: 20)
 *          minScore - Minimum matching score (default: 50)
 *          includeReasons - Include match reasons (default: true)
 *          sortBy - Sort criteria: score, rating, rate (default: score)
 */
router.get('/taskers/:providerId', 
  cacheMatchingResults,
  aiMatchingController.findMatchingTaskers
);

/**
 * @route   GET /api/ai-matching/providers/:taskerId
 * @desc    Find matching providers for a tasker
 * @access  Private
 * @params  taskerId - Tasker's user ID
 * @query   limit - Number of results (default: 20)
 *          minScore - Minimum matching score (default: 50)
 *          includeReasons - Include match reasons (default: true)
 *          sortBy - Sort criteria: score, rating (default: score)
 *          hasActiveGigs - Only providers with active gigs (default: false)
 */
router.get('/providers/:taskerId', 
  cacheMatchingResults,
  aiMatchingController.findMatchingProviders
);

/**
 * @route   GET /api/ai-matching/insights/:userId
 * @desc    Get matching insights and recommendations for a user
 * @access  Private
 * @params  userId - User's ID
 */
router.get('/insights/:userId', 
  cacheMatchingResults,
  aiMatchingController.getMatchingInsights
);

/**
 * @route   POST /api/ai-matching/batch
 * @desc    Batch match multiple users (admin/analytics)
 * @access  Private (Admin only)
 * @body    userIds - Array of user IDs
 *          targetRole - Target role to match against (default: tasker)
 */
router.post('/batch', 
  authController.restrictTo('admin'), 
  aiMatchingController.batchMatch
);

module.exports = router;