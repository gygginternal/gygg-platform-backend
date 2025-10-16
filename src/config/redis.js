import redis from 'redis';
import logger from '../utils/logger.js';

// Create Valkey client (Valkey is API compatible with Redis)
const redisClient = redis.createClient({
  socket: {
    host: process.env.VALKEY_HOST || process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.VALKEY_PORT || process.env.REDIS_PORT || 6380),
    // Add connection options for better compatibility with AWS ElastiCache
    connectTimeout: 30000, // 30 seconds
    commandTimeout: 20000, // 20 seconds
    // For AWS ElastiCache, you might need to disable TLS if not using TLS endpoint
    // tls: process.env.VALKEY_TLS === 'true' ? {} : undefined,
  },
  // Add retry strategy for more resilient connections in cloud environments
  retryDelayOnFailover: 100,
  maxRetriesPerRequest: 3,
  // Add authentication if your ElastiCache cluster requires it
  username: process.env.VALKEY_USERNAME || undefined,
  password: process.env.VALKEY_PASSWORD || process.env.REDIS_PASSWORD || undefined,
});

redisClient.on('connect', () => {
  logger.info('✅ Connected to Valkey successfully');
});

redisClient.on('error', (err) => {
  logger.error('❌ Valkey connection error:', err);
});

redisClient.on('reconnecting', () => {
  logger.info('🔄 Reconnecting to Valkey...');
});

// Export the client for connection management
export default redisClient;

// Export connection function
export const connectRedis = async () => {
  try {
    await redisClient.connect();
    return true;
  } catch (error) {
    logger.error('❌ Failed to connect to Valkey:', error);
    logger.error('💡 Make sure your Valkey server is running and check your environment variables (VALKEY_HOST, VALKEY_PORT)');
    return false;
  }
};