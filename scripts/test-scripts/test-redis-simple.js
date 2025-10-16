import redis from 'redis';
import dotenv from 'dotenv';

dotenv.config();

// Create Valkey client with configuration from environment (using Redis client - Valkey is API compatible)
const redisClient = redis.createClient({
  socket: {
    host: process.env.VALKEY_HOST || process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.VALKEY_PORT || process.env.REDIS_PORT) || 6379,
    connectTimeout: 30000, // 30 seconds
    commandTimeout: 20000, // 20 seconds
  },
});

redisClient.on('connect', () => {
  console.log('✅ Connected to Redis successfully');
});

redisClient.on('error', (err) => {
  console.error('❌ Redis connection error:', err);
});

try {
  console.log('Attempting to connect to Valkey (using Redis client - Valkey is API compatible)...');
  console.log('Valkey Host:', process.env.VALKEY_HOST);
  console.log('Redis Host:', process.env.REDIS_HOST); // For backward compatibility
  console.log('Valkey Port:', process.env.VALKEY_PORT);
  console.log('Redis Port:', process.env.REDIS_PORT); // For backward compatibility
  
  await redisClient.connect();
  
  // Test basic operations
  console.log('Testing Redis operations...');
  
  // Set a test key
  await redisClient.set('test-key', 'Hello Redis!', { EX: 60 }); // Expires in 60 seconds
  console.log('✅ Set test key');
  
  // Get the test key
  const value = await redisClient.get('test-key');
  console.log('✅ Retrieved test key:', value);
  
  // Test hash operations
  await redisClient.hSet('test-hash', { field1: 'value1', field2: 'value2' });
  console.log('✅ Set hash fields');
  
  const hashValue = await redisClient.hGetAll('test-hash');
  console.log('✅ Retrieved hash:', hashValue);
  
  console.log('✅ All basic Redis tests passed successfully!');
  
  // Clean up
  await redisClient.del('test-key', 'test-hash');
  
  await redisClient.quit();
  console.log('Redis connection closed.');
} catch (error) {
  console.error('❌ Error during Redis test:', error);
  process.exit(1);
}