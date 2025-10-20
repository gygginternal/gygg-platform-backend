import redisClient from './src/config/redis.js';
import logger from './src/utils/logger.js';

async function testConnection() {
  try {
    console.log('Attempting to connect to Valkey...');
    await redisClient.connect();
    console.log('✅ Successfully connected to Valkey!');
    
    // Test a simple operation
    await redisClient.set('test-key', 'test-value', { EX: 10 }); // Expires in 10 seconds
    const value = await redisClient.get('test-key');
    console.log('✅ Test operation successful:', value);
    
    await redisClient.quit();
    console.log('Disconnected from Valkey.');
  } catch (error) {
    console.error('❌ Valkey connection failed:', error.message);
    console.error('Error details:', error);
  }
}

testConnection();