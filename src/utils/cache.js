import redisClient from '../config/redis.js';
import logger from './logger.js';

// Redis-based cache with fallback handling
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
      logger.error('Redis get error:', error.message);
      this.stats.redisErrors++;
      return null;
    }
    
    this.stats.misses++;
    return null;
  }

  // Set value in cache
  async set(key, value, ttl = parseInt(process.env.REDIS_TTL || '300')) {
    try {
      await redisClient.setEx(key, ttl, JSON.stringify(value));
    } catch (error) {
      logger.error('Redis set error:', error.message);
    }
  }

  // Delete item from cache
  async del(key) {
    try {
      await redisClient.del(key);
    } catch (error) {
      logger.error('Redis del error:', error.message);
    }
  }

  // Set with specific TTL
  async setWithTTL(key, value, ttlSeconds) {
    try {
      await redisClient.setEx(key, ttlSeconds, JSON.stringify(value));
    } catch (error) {
      logger.error('Redis setEx error:', error.message);
    }
  }

  // Check if key exists
  async has(key) {
    try {
      const exists = await redisClient.exists(key);
      return exists === 1;
    } catch (error) {
      logger.error('Redis exists error:', error.message);
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

// Cache middleware for Express
export const cacheMiddleware = (ttl = parseInt(process.env.REDIS_TTL || '300')) => {
  return async (req, res, next) => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }

    const key = `cache:${req.method}:${req.originalUrl}`;
    
    try {
      const cached = await cache.get(key);
      if (cached) {
        logger.debug('Cache HIT', { key, url: req.originalUrl });
        return res.status(200).json(cached);
      }
    } catch (error) {
      logger.error('Cache middleware error:', error);
    }

    logger.debug('Cache MISS', { key, url: req.originalUrl });

    // Override res.send to cache the response
    const originalSend = res.send;
    res.send = async function(data) {
      try {
        const jsonData = JSON.parse(data);
        if (jsonData.status === 'success') {
          await cache.set(key, jsonData, ttl);
          logger.debug('Response cached', { key, ttl });
        }
      } catch (error) {
        logger.warn('Failed to cache response - invalid JSON', { 
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
export const cacheUserData = async (userId, data, ttl = parseInt(process.env.REDIS_USER_TTL || '600')) => {
  const key = `user:${userId}`;
  await cache.set(key, data, ttl);
  logger.debug('User data cached', { userId, key, ttl });
};

export const getCachedUserData = async (userId) => {
  const key = `user:${userId}`;
  return await cache.get(key);
};

export const invalidateUserCache = async (userId) => {
  const key = `user:${userId}`;
  await cache.del(key);
  logger.debug('User cache invalidated', { userId, key });
};

export const cacheGigData = async (gigId, data, ttl = parseInt(process.env.REDIS_TTL || '300')) => {
  const key = `gig:${gigId}`;
  await cache.set(key, data, ttl);
  logger.debug('Gig data cached', { gigId, key, ttl });
};

export const getCachedGigData = async (gigId) => {
  const key = `gig:${gigId}`;
  return await cache.get(key);
};

export const invalidateGigCache = async (gigId) => {
  const key = `gig:${gigId}`;
  await cache.del(key);
  logger.debug('Gig cache invalidated', { gigId, key });
};

export const cacheContractData = async (contractId, data, ttl = parseInt(process.env.REDIS_TTL || '300')) => {
  const key = `contract:${contractId}`;
  await cache.set(key, data, ttl);
  logger.debug('Contract data cached', { contractId, key, ttl });
};

export const getCachedContractData = async (contractId) => {
  const key = `contract:${contractId}`;
  return await cache.get(key);
};

export const invalidateContractCache = async (contractId) => {
  const key = `contract:${contractId}`;
  await cache.del(key);
  logger.debug('Contract cache invalidated', { contractId, key });
};

export const cachePostData = async (postId, data, ttl = parseInt(process.env.REDIS_TTL || '300')) => {
  const key = `post:${postId}`;
  await cache.set(key, data, ttl);
  logger.debug('Post data cached', { postId, key, ttl });
};

export const getCachedPostData = async (postId) => {
  const key = `post:${postId}`;
  return await cache.get(key);
};

export const invalidatePostCache = async (postId) => {
  const key = `post:${postId}`;
  await cache.del(key);
  logger.debug('Post cache invalidated', { postId, key });
};

// Clear all cache (use carefully in production)
export const clearAllCache = async () => {
  try {
    await redisClient.flushAll();
    logger.info('All cache cleared');
  } catch (error) {
    logger.error('Error clearing cache:', error);
  }
};

// Get cache statistics
export const getCacheStats = () => {
  return cache.getStats();
};

export default {
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