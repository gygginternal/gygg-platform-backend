import mongoose from 'mongoose';
import { logError, logSecurityEvent, SECURITY_EVENTS } from '../utils/securityLogger.js';

// Database connection options with security enhancements
const getDatabaseOptions = () => {
  const baseOptions = {
    // Connection pool settings
    maxPoolSize: 10, // Maintain up to 10 socket connections
    serverSelectionTimeoutMS: 5000, // Keep trying to send operations for 5 seconds
    socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
    bufferMaxEntries: 0, // Disable mongoose buffering
    bufferCommands: false, // Disable mongoose buffering
    
    // Security settings
    authSource: 'admin', // Specify the database to authenticate against
    retryWrites: true, // Retry writes on network errors
    w: 'majority', // Write concern - wait for majority of replica set members
    
    // SSL/TLS settings for production
    ssl: process.env.NODE_ENV === 'production',
    sslValidate: process.env.NODE_ENV === 'production',
    
    // Connection monitoring
    heartbeatFrequencyMS: 10000, // How often to check server status
    
    // Compression
    compressors: ['zlib'],
    zlibCompressionLevel: 6
  };

  // Add SSL certificate options for production
  if (process.env.NODE_ENV === 'production' && process.env.DB_SSL_CERT) {
    baseOptions.sslCert = process.env.DB_SSL_CERT;
    baseOptions.sslKey = process.env.DB_SSL_KEY;
    baseOptions.sslCA = process.env.DB_SSL_CA;
  }

  return baseOptions;
};

// Enhanced connection function with security monitoring
const connectDatabase = async () => {
  try {
    // Validate required environment variables
    if (!process.env.DATABASE_URI) {
      throw new Error('DATABASE_URI environment variable is required');
    }

    // Parse connection string to validate format (without logging sensitive parts)
    const dbUri = process.env.DATABASE_URI;
    const uriParts = dbUri.split('@');
    if (uriParts.length < 2) {
      throw new Error('Invalid database URI format');
    }

    // Set mongoose options for security
    mongoose.set('strictQuery', true); // Prepare for Mongoose 7
    mongoose.set('sanitizeFilter', true); // Enable query sanitization
    
    // Connect with security options
    const options = getDatabaseOptions();
    await mongoose.connect(dbUri, options);

    // Log successful connection (without sensitive details)
    const dbName = mongoose.connection.db.databaseName;
    const host = mongoose.connection.host;
    const port = mongoose.connection.port;
    
    logSecurityEvent(SECURITY_EVENTS.DATA_ACCESS, {
      action: 'database_connected',
      database: dbName,
      host: host.replace(/.*@/, '[REDACTED]@'), // Hide credentials in host
      port,
      ssl: options.ssl
    });

    console.log(`✅ Database connected: ${dbName} on ${host}:${port}`);

    // Set up connection event handlers
    setupConnectionHandlers();

  } catch (error) {
    logError(error, {
      action: 'database_connection_failed',
      uri: process.env.DATABASE_URI ? '[REDACTED]' : 'missing'
    });
    
    console.error('❌ Database connection failed:', error.message);
    process.exit(1);
  }
};

// Set up connection monitoring and security handlers
const setupConnectionHandlers = () => {
  const db = mongoose.connection;

  // Connection events
  db.on('connected', () => {
    console.log('📡 Mongoose connected to database');
  });

  db.on('error', (error) => {
    logError(error, {
      action: 'database_error',
      readyState: db.readyState
    });
    console.error('❌ Mongoose connection error:', error);
  });

  db.on('disconnected', () => {
    logSecurityEvent(SECURITY_EVENTS.DATA_ACCESS, {
      action: 'database_disconnected',
      timestamp: new Date().toISOString()
    });
    console.log('📡 Mongoose disconnected');
  });

  // Reconnection handling
  db.on('reconnected', () => {
    logSecurityEvent(SECURITY_EVENTS.DATA_ACCESS, {
      action: 'database_reconnected',
      timestamp: new Date().toISOString()
    });
    console.log('📡 Mongoose reconnected');
  });

  // Handle application termination
  process.on('SIGINT', async () => {
    try {
      await db.close();
      console.log('📡 Mongoose connection closed through app termination');
      process.exit(0);
    } catch (error) {
      logError(error, { action: 'database_close_failed' });
      process.exit(1);
    }
  });
};

// Database health check function
const checkDatabaseHealth = async () => {
  try {
    const adminDb = mongoose.connection.db.admin();
    const result = await adminDb.ping();
    
    return {
      status: 'healthy',
      ping: result.ok === 1,
      readyState: mongoose.connection.readyState,
      host: mongoose.connection.host,
      name: mongoose.connection.name
    };
  } catch (error) {
    logError(error, { action: 'database_health_check_failed' });
    
    return {
      status: 'unhealthy',
      error: error.message,
      readyState: mongoose.connection.readyState
    };
  }
};

// Database security middleware for queries
const securityMiddleware = function(next) {
  // Log potentially dangerous queries
  const dangerousOperations = ['$where', '$regex', '$text'];
  const query = this.getQuery();
  
  if (query && typeof query === 'object') {
    const queryString = JSON.stringify(query);
    const hasDangerousOp = dangerousOperations.some(op => queryString.includes(op));
    
    if (hasDangerousOp) {
      logSecurityEvent(SECURITY_EVENTS.SUSPICIOUS_ACTIVITY, {
        action: 'potentially_dangerous_query',
        operation: this.op,
        model: this.model.modelName,
        query: queryString.substring(0, 200) // Limit log size
      });
    }
  }
  
  next();
};

// Apply security middleware to all schemas
const applySecurityMiddleware = () => {
  // Apply to all query operations
  mongoose.plugin(function(schema) {
    schema.pre(['find', 'findOne', 'findOneAndUpdate', 'findOneAndDelete'], securityMiddleware);
  });
};

// Database performance monitoring
const monitorPerformance = () => {
  mongoose.set('debug', (collectionName, method, query, doc) => {
    if (process.env.NODE_ENV === 'development') {
      console.log(`🔍 ${collectionName}.${method}`, JSON.stringify(query));
    }
    
    // Log slow queries in production
    const start = Date.now();
    return function() {
      const duration = Date.now() - start;
      if (duration > 1000) { // Log queries taking more than 1 second
        logSecurityEvent(SECURITY_EVENTS.DATA_ACCESS, {
          action: 'slow_query',
          collection: collectionName,
          method,
          duration: `${duration}ms`,
          query: JSON.stringify(query).substring(0, 200)
        });
      }
    };
  });
};

// Initialize database security features
const initializeDatabaseSecurity = () => {
  applySecurityMiddleware();
  
  if (process.env.NODE_ENV === 'production') {
    monitorPerformance();
  }
};

export {
  connectDatabase,
  checkDatabaseHealth,
  initializeDatabaseSecurity,
  getDatabaseOptions
};

export default connectDatabase;