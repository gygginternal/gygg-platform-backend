import NodeCache from 'node-cache';
import logger from '../utils/logger.js';

// In-memory blacklist for JWT tokens (for production, use Redis)
const tokenBlacklist = new NodeCache({ 
  stdTTL: 7 * 24 * 60 * 60, // 7 days (match JWT expiration)
  checkperiod: 60 * 60 // Check for expired entries every hour
});

/**
 * Add token to blacklist
 * @param {string} token - JWT token to blacklist
 * @param {number} exp - Token expiration timestamp
 */
export const blacklistToken = (token, exp) => {
  try {
    const ttl = exp - Math.floor(Date.now() / 1000);
    if (ttl > 0) {
      tokenBlacklist.set(token, true, ttl);
      logger.info('Token blacklisted successfully');
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
export const isTokenBlacklisted = (token) => {
  return tokenBlacklist.has(token);
};

/**
 * Get blacklist statistics
 * @returns {object} - Blacklist statistics
 */
export const getBlacklistStats = () => {
  return {
    keys: tokenBlacklist.keys().length,
    stats: tokenBlacklist.getStats()
  };
};