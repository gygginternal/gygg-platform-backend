const redisClient = require('../config/redis.js');
const logger = require('./logger.js');

// Valkey-based cache with fallback handling (using Redis client - Valkey is API compatible)
class RedisCache {
  constructor() {
    this.stats = {
      hits: 0,
      misses: 0,
      redisErrors: 0
    };
  }

  // Get value from cache
  async get(key) {
    try {
      const value = await redisClient.get(key);
      if (value) {
        this.stats.hits++;
        return JSON.parse(value);
      }
    } catch (error) {
      logger.error('Valkey get error:', error.message);
      this.stats.redisErrors++;
      return null;
    }
    
    this.stats.misses++;
    return null;
  }

  // Set value in cache
  async set(key, value, ttl = parseInt(process.env.VALKEY_TTL || process.env.REDIS_TTL || '300')) {
    try {
      await redisClient.setEx(key, ttl, JSON.stringify(value));
    } catch (error) {
      logger.error('Valkey set error:', error.message);
    }
  }

  // Delete item from cache
  async del(key) {
    try {
      await redisClient.del(key);
    } catch (error) {
      logger.error('Valkey del error:', error.message);
    }
  }

  // Set with specific TTL
  async setWithTTL(key, value, ttlSeconds) {
    try {
      await redisClient.setEx(key, ttlSeconds, JSON.stringify(value));
    } catch (error) {
      logger.error('Valkey setEx error:', error.message);
    }
  }

  // Check if key exists
  async has(key) {
    try {
      const exists = await redisClient.exists(key);
      return exists === 1;
    } catch (error) {
      logger.error('Valkey exists error:', error.message);
      return false;
    }
  }

  // Get cache statistics
  getStats() {
    return {
      ...this.stats,
      hitRate: this.stats.hits / (this.stats.hits + this.stats.misses) || 0
    };
  }
}

// Create singleton instance
const cache = new RedisCache();

// Valkey cache middleware for Express (using Redis client - Valkey is API compatible)
const cacheMiddleware = (ttl = parseInt(process.env.VALKEY_TTL || process.env.REDIS_TTL || '300')) => {
  return async (req, res, next) => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }

    const key = `cache:${req.method}:${req.originalUrl}`;
    
    try {
      const cached = await cache.get(key);
      if (cached) {
        logger.debug('Cache HIT (Valkey)', { key, url: req.originalUrl });
        return res.status(200).json(cached);
      }
    } catch (error) {
      logger.error('Cache middleware error (Valkey):', error);
    }

    logger.debug('Cache MISS (Valkey)', { key, url: req.originalUrl });

    // Override res.send to cache the response
    const originalSend = res.send;
    res.send = async function(data) {
      try {
        const jsonData = JSON.parse(data);
        if (jsonData.status === 'success') {
          await cache.set(key, jsonData, ttl);
          logger.debug('Response cached (Valkey)', { key, ttl });
        }
      } catch (error) {
        logger.warn('Failed to cache response (Valkey) - invalid JSON', { 
          key, 
          error: error.message 
        });
      }

      res.send = originalSend;
      return originalSend.call(this, data);
    };

    next();
  };
};

// Specific caching functions for your data
const cacheUserData = async (userId, data, ttl = parseInt(process.env.VALKEY_USER_TTL || process.env.REDIS_USER_TTL || '600')) => {
  const key = `user:${userId}`;
  await cache.set(key, data, ttl);
  logger.debug('User data cached (Valkey)', { userId, key, ttl });
};

const getCachedUserData = async (userId) => {
  const key = `user:${userId}`;
  return await cache.get(key);
};

const invalidateUserCache = async (userId) => {
  const key = `user:${userId}`;
  await cache.del(key);
  logger.debug('User cache invalidated (Valkey)', { userId, key });
};

const cacheGigData = async (gigId, data, ttl = parseInt(process.env.VALKEY_TTL || process.env.REDIS_TTL || '300')) => {
  const key = `gig:${gigId}`;
  await cache.set(key, data, ttl);
  logger.debug('Gig data cached (Valkey)', { gigId, key, ttl });
};

const getCachedGigData = async (gigId) => {
  const key = `gig:${gigId}`;
  return await cache.get(key);
};

const invalidateGigCache = async (gigId) => {
  const key = `gig:${gigId}`;
  await cache.del(key);
  logger.debug('Gig cache invalidated (Valkey)', { gigId, key });
};

const cacheContractData = async (contractId, data, ttl = parseInt(process.env.VALKEY_TTL || process.env.REDIS_TTL || '300')) => {
  const key = `contract:${contractId}`;
  await cache.set(key, data, ttl);
  logger.debug('Contract data cached (Valkey)', { contractId, key, ttl });
};

const getCachedContractData = async (contractId) => {
  const key = `contract:${contractId}`;
  return await cache.get(key);
};

const invalidateContractCache = async (contractId) => {
  const key = `contract:${contractId}`;
  await cache.del(key);
  logger.debug('Contract cache invalidated (Valkey)', { contractId, key });
};

const cachePostData = async (postId, data, ttl = parseInt(process.env.VALKEY_TTL || process.env.REDIS_TTL || '300')) => {
  const key = `post:${postId}`;
  await cache.set(key, data, ttl);
  logger.debug('Post data cached (Valkey)', { postId, key, ttl });
};

const getCachedPostData = async (postId) => {
  const key = `post:${postId}`;
  return await cache.get(key);
};

const invalidatePostCache = async (postId) => {
  const key = `post:${postId}`;
  await cache.del(key);
  logger.debug('Post cache invalidated (Valkey)', { postId, key });
};

// Clear all cache (use carefully in production)
const clearAllCache = async () => {
  try {
    await redisClient.flushAll();
    logger.info('All Valkey cache cleared');
  } catch (error) {
    logger.error('Error clearing Valkey cache:', error);
  }
};

// Get cache statistics
const getCacheStats = () => {
  return cache.getStats();
};

module.exports = {
  cache,
  cacheMiddleware,
  cacheUserData,
  getCachedUserData,
  invalidateUserCache,
  cacheGigData,
  getCachedGigData,
  invalidateGigCache,
  cacheContractData,
  getCachedContractData,
  invalidateContractCache,
  cachePostData,
  getCachedPostData,
  invalidatePostCache,
  clearAllCache,
  getCacheStats
};