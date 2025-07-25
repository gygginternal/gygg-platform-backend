#!/usr/bin/env node

/**
 * Production-ready server with Redis, monitoring, and alerting
 */

import dotenv from 'dotenv';

// Load environment variables first
dotenv.config({ path: './.env' });

import app from './src/app.js';
import { initializeServices, setupGracefulShutdown } from './src/startup/initializeServices.js';
import { logSecurityEvent, SECURITY_EVENTS } from './src/utils/securityLogger.js';

// Validate required environment variables
const requiredEnvVars = [
  'NODE_ENV',
  'PORT',
  'DATABASE_URI',
  'JWT_SECRET',
  'STRIPE_SECRET_KEY',
  'FRONTEND_URL'
];

const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);
if (missingEnvVars.length > 0) {
  console.error('❌ Missing required environment variables:', missingEnvVars.join(', '));
  console.error('Please check your .env file and ensure all required variables are set.');
  process.exit(1);
}

// Validate JWT secret strength
if (process.env.JWT_SECRET.length < 32) {
  console.error('❌ JWT_SECRET must be at least 32 characters long for security');
  process.exit(1);
}

// Set up graceful shutdown handlers
setupGracefulShutdown();

// Start the server
const startServer = async () => {
  try {
    console.log(`🚀 Starting Gig Platform API Server...`);
    console.log(`📊 Environment: ${process.env.NODE_ENV}`);
    console.log(`🔧 Node.js version: ${process.version}`);
    
    // Initialize all services
    const services = await initializeServices();
    
    // Start HTTP server
    const PORT = process.env.PORT || 5000;
    const server = app.listen(PORT, () => {
      console.log(`\n🌟 Server running on port ${PORT}`);
      console.log(`🔗 API URL: http://localhost:${PORT}`);
      console.log(`📚 API Docs: http://localhost:${PORT}/api-docs`);
      console.log(`💚 Health Check: http://localhost:${PORT}/health`);
      
      if (process.env.NODE_ENV === 'development') {
        console.log(`🔍 Monitoring: http://localhost:${PORT}/api/v1/monitoring/health`);
      }
      
      console.log('\n📋 Service Status:');
      console.log(`  Database: ${services.database ? '✅ Connected' : '❌ Failed'}`);
      console.log(`  Redis: ${services.redis ? '✅ Connected' : '⚠️ Memory fallback'}`);
      console.log(`  Alerting: ${services.alerting ? '✅ Active' : '❌ Failed'}`);
      
      console.log('\n🎉 Server is ready to accept connections!');
      
      // Log server startup
      logSecurityEvent(SECURITY_EVENTS.DATA_ACCESS, {
        action: 'server_started',
        port: PORT,
        environment: process.env.NODE_ENV,
        services,
        timestamp: new Date().toISOString()
      });
    });

    // Handle server errors
    server.on('error', (error) => {
      if (error.syscall !== 'listen') {
        throw error;
      }

      const bind = typeof PORT === 'string' ? 'Pipe ' + PORT : 'Port ' + PORT;

      switch (error.code) {
        case 'EACCES':
          console.error(`❌ ${bind} requires elevated privileges`);
          process.exit(1);
          break;
        case 'EADDRINUSE':
          console.error(`❌ ${bind} is already in use`);
          process.exit(1);
          break;
        default:
          throw error;
      }
    });

    // Store server reference for graceful shutdown
    process.server = server;

  } catch (error) {
    console.error('❌ Failed to start server:', error.message);
    
    logSecurityEvent(SECURITY_EVENTS.DATA_ACCESS, {
      action: 'server_startup_failed',
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    
    process.exit(1);
  }
};

// Handle process warnings
process.on('warning', (warning) => {
  console.warn('⚠️ Process Warning:', warning.name, warning.message);
});

// Start the server
startServer().catch((error) => {
  console.error('💥 Unhandled error during server startup:', error);
  process.exit(1);
});