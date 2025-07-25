import redisManager from '../config/redis.js';
import alertingService from '../services/alertingService.js';
import { connectDatabase } from '../config/database.js';
import { logSecurityEvent, SECURITY_EVENTS } from '../utils/securityLogger.js';

/**
 * Initialize all services required for the application
 */
export const initializeServices = async () => {
  console.log('🚀 Initializing services...');
  
  const services = {
    database: false,
    redis: false,
    alerting: false
  };

  try {
    // Initialize database connection
    console.log('📊 Connecting to database...');
    await connectDatabase();
    services.database = true;
    console.log('✅ Database connected');

    // Initialize Redis (optional)
    console.log('🔄 Initializing Redis...');
    services.redis = await redisManager.initialize();
    if (services.redis) {
      console.log('✅ Redis connected');
    } else {
      console.log('⚠️ Redis not available, using memory fallback');
    }

    // Initialize alerting service
    console.log('🚨 Initializing alerting service...');
    await alertingService.initialize();
    services.alerting = true;
    console.log('✅ Alerting service initialized');

    // Log successful initialization
    logSecurityEvent(SECURITY_EVENTS.DATA_ACCESS, {
      action: 'services_initialized',
      services,
      timestamp: new Date().toISOString()
    });

    console.log('🎉 All services initialized successfully');
    return services;

  } catch (error) {
    console.error('❌ Service initialization failed:', error.message);
    
    // Log initialization failure
    logSecurityEvent(SECURITY_EVENTS.DATA_ACCESS, {
      action: 'services_initialization_failed',
      error: error.message,
      services,
      timestamp: new Date().toISOString()
    });

    // Don't exit the process, let the app start with available services
    console.log('⚠️ Starting with limited functionality');
    return services;
  }
};

/**
 * Graceful shutdown of all services
 */
export const shutdownServices = async () => {
  console.log('🛑 Shutting down services...');

  try {
    // Close Redis connections
    if (redisManager.isConnected) {
      await redisManager.disconnect();
      console.log('✅ Redis disconnected');
    }

    // Close database connection
    const mongoose = await import('mongoose');
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
      console.log('✅ Database disconnected');
    }

    console.log('🎉 All services shut down gracefully');
  } catch (error) {
    console.error('❌ Error during shutdown:', error.message);
  }
};

/**
 * Health check for all services
 */
export const checkServicesHealth = async () => {
  const health = {
    timestamp: new Date().toISOString(),
    services: {}
  };

  try {
    // Check database health
    const { checkDatabaseHealth } = await import('../config/database.js');
    health.services.database = await checkDatabaseHealth();
  } catch (error) {
    health.services.database = { status: 'error', error: error.message };
  }

  try {
    // Check Redis health
    health.services.redis = await redisManager.healthCheck();
  } catch (error) {
    health.services.redis = { status: 'error', error: error.message };
  }

  try {
    // Check alerting service health
    health.services.alerting = await alertingService.healthCheck();
  } catch (error) {
    health.services.alerting = { status: 'error', error: error.message };
  }

  // Determine overall health
  const allHealthy = Object.values(health.services).every(service => 
    service.status === 'healthy' || service.status === 'connected'
  );

  health.overall = allHealthy ? 'healthy' : 'degraded';

  return health;
};

/**
 * Setup graceful shutdown handlers
 */
export const setupGracefulShutdown = () => {
  const gracefulShutdown = async (signal) => {
    console.log(`\n📡 Received ${signal}, starting graceful shutdown...`);
    
    try {
      await shutdownServices();
      console.log('✅ Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      console.error('❌ Error during graceful shutdown:', error.message);
      process.exit(1);
    }
  };

  // Handle different shutdown signals
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  
  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    console.error('💥 Uncaught Exception:', error);
    logSecurityEvent(SECURITY_EVENTS.DATA_ACCESS, {
      action: 'uncaught_exception',
      error: error.message,
      stack: error.stack
    });
    gracefulShutdown('uncaughtException');
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
    logSecurityEvent(SECURITY_EVENTS.DATA_ACCESS, {
      action: 'unhandled_rejection',
      reason: reason?.message || reason,
      promise: promise.toString()
    });
    gracefulShutdown('unhandledRejection');
  });

  console.log('🛡️ Graceful shutdown handlers registered');
};

export default {
  initializeServices,
  shutdownServices,
  checkServicesHealth,
  setupGracefulShutdown
};