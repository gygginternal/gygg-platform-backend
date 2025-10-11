import redis from 'redis';
import dotenv from 'dotenv';

dotenv.config();

// Create Redis client with configuration from environment
const redisClient = redis.createClient({
  socket: {
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT) || 6379,
  },
});

redisClient.on('connect', () => {
  console.log('✅ Connected to Redis successfully');
});

redisClient.on('error', (err) => {
  console.error('❌ Redis connection error:', err);
});

try {
  console.log('Attempting to connect to Redis...');
  console.log('Redis Host:', process.env.REDIS_HOST);
  console.log('Redis Port:', process.env.REDIS_PORT);
  
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