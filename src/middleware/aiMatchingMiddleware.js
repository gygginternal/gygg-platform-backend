const rateLimit = require('express-rate-limit');
const NodeCache = require('node-cache');
const AppError = require('../utils/appError');

// Cache for storing matching results (TTL: 1 hour)
const matchingCache = new NodeCache({ stdTTL: 3600 });

/**
 * Rate limiting for AI matching endpoints
 * Prevents abuse and ensures fair usage
 */
const aiMatchingRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // Limit each IP to 50 requests per windowMs
  message: {
    status: 'error',
    message: 'Too many matching requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Skip rate limiting for admin users
  skip: (req) => {
    return req.user && req.user.role === 'admin';
  }
});

/**
 * Premium rate limiting for premium users
 * Higher limits for premium subscribers
 */
const premiumRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // Higher limit for premium users
  message: {
    status: 'error',
    message: 'Premium rate limit exceeded, please try again later.'
  },
  skip: (req) => {
    return req.user && (req.user.role === 'admin' || !req.user.isPremium);
  }
});

/**
 * Caching middleware for matching results
 * Caches results based on user ID and query parameters
 */
const cacheMatchingResults = (req, res, next) => {
  // Generate cache key based on route, user ID, and query parameters
  const cacheKey = `${req.route.path}_${req.params.providerId || req.params.taskerId || req.params.userId}_${JSON.stringify(req.query)}`;
  
  // Check if result exists in cache
  const cachedResult = matchingCache.get(cacheKey);
  
  if (cachedResult) {
    return res.status(200).json({
      ...cachedResult,
      cached: true,
      cacheTimestamp: new Date().toISOString()
    });
  }
  
  // Store original res.json function
  const originalJson = res.json;
  
  // Override res.json to cache the result
  res.json = function(data) {
    // Cache successful responses only
    if (data.status === 'success') {
      matchingCache.set(cacheKey, data);
    }
    
    // Call original json function
    originalJson.call(this, data);
  };
  
  next();
};

/**
 * Validate matching request parameters
 */
const validateMatchingRequest = (req, res, next) => {
  const { limit, minScore, sortBy } = req.query;
  
  // Validate limit
  if (limit && (isNaN(limit) || parseInt(limit) < 1 || parseInt(limit) > 100)) {
    return next(new AppError('Limit must be a number between 1 and 100', 400));
  }
  
  // Validate minScore
  if (minScore && (isNaN(minScore) || parseInt(minScore) < 0 || parseInt(minScore) > 100)) {
    return next(new AppError('Minimum score must be a number between 0 and 100', 400));
  }
  
  // Validate sortBy
  const validSortOptions = ['score', 'rating', 'rate'];
  if (sortBy && !validSortOptions.includes(sortBy)) {
    return next(new AppError(`Sort option must be one of: ${validSortOptions.join(', ')}`, 400));
  }
  
  next();
};

/**
 * Log matching requests for analytics
 */
const logMatchingRequest = (req, res, next) => {
  const logData = {
    userId: req.user?.id,
    endpoint: req.route.path,
    params: req.params,
    query: req.query,
    timestamp: new Date().toISOString(),
    userAgent: req.get('User-Agent'),
    ip: req.ip
  };
  
  // In a real application, this would be sent to an analytics service
  console.log('AI Matching Request:', logData);
  
  next();
};

/**
 * Check user permissions for matching
 */
const checkMatchingPermissions = (req, res, next) => {
  const { user } = req;
  const { providerId, taskerId, userId } = req.params;
  
  // Users can only request matches for themselves unless they're admin
  const requestedUserId = providerId || taskerId || userId;
  
  if (user.role !== 'admin' && user.id !== requestedUserId) {
    return next(new AppError('You can only request matches for your own profile', 403));
  }
  
  next();
};

/**
 * Clear cache for specific user
 */
const clearUserCache = (userId) => {
  const keys = matchingCache.keys();
  const userKeys = keys.filter(key => key.includes(userId));
  
  userKeys.forEach(key => {
    matchingCache.del(key);
  });
  
  console.log(`Cleared ${userKeys.length} cache entries for user ${userId}`);
};

/**
 * Clear all matching cache
 */
const clearAllCache = () => {
  matchingCache.flushAll();
  console.log('Cleared all matching cache');
};

/**
 * Get cache statistics
 */
const getCacheStats = () => {
  return {
    keys: matchingCache.keys().length,
    stats: matchingCache.getStats(),
    size: matchingCache.keys().length
  };
};

module.exports = {
  aiMatchingRateLimit,
  premiumRateLimit,
  cacheMatchingResults,
  validateMatchingRequest,
  logMatchingRequest,
  checkMatchingPermissions,
  clearUserCache,
  clearAllCache,
  getCacheStats
};