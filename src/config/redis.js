import redis from 'redis';
import logger from '../utils/logger.js';

// Create Redis client
const redisClient = redis.createClient({
  socket: {
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT) || 6379,
  },
});

redisClient.on('connect', () => {
  logger.info('✅ Connected to Redis successfully');
});

redisClient.on('error', (err) => {
  logger.error('❌ Redis connection error:', err);
});

// Export the client for connection management
export default redisClient;

// Export connection function
export const connectRedis = async () => {
  try {
    await redisClient.connect();
    return true;
  } catch (error) {
    logger.error('❌ Failed to connect to Redis:', error);
    return false;
  }
};