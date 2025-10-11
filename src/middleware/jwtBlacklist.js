import redisClient from '../config/redis.js';
import logger from '../utils/logger.js';

/**
 * Add token to blacklist
 * @param {string} token - JWT token to blacklist
 * @param {number} exp - Token expiration timestamp
 */
export const blacklistToken = async (token, exp) => {
  try {
    const ttl = exp - Math.floor(Date.now() / 1000);
    if (ttl > 0) {
      await redisClient.setEx(`blacklist:${token}`, ttl, '1');
      logger.info('Token blacklisted successfully', { token: token.substring(0, 10) + '...' });
    }
  } catch (error) {
    logger.error('Failed to blacklist token:', error);
  }
};

/**
 * Check if token is blacklisted
 * @param {string} token - JWT token to check
 * @returns {boolean} - True if token is blacklisted
 */
export const isTokenBlacklisted = async (token) => {
  try {
    const result = await redisClient.get(`blacklist:${token}`);
    return result !== null;
  } catch (error) {
    logger.error('Failed to check blacklist:', error);
    return false; // Fail safe - don't block if Redis is down
  }
};

/**
 * Get blacklist statistics
 * @returns {object} - Blacklist statistics
 */
export const getBlacklistStats = async () => {
  try {
    // This is a simple example - for actual implementation you might want to use SCAN
    // For now, we'll just return a simple count method
    const keys = await redisClient.keys('blacklist:*');
    return {
      keys: keys ? keys.length : 0
    };
  } catch (error) {
    logger.error('Failed to get blacklist stats:', error);
    return { keys: 0 };
  }
};