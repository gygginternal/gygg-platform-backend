// src/config/db.js

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import logger from '../utils/logger.js'; 

// Load environment variables from .env file
dotenv.config({ path: './.env' });

/**
 * Establishes a connection to MongoDB using Mongoose.
 * Includes safety checks for missing environment variables and replica set usage.
 */
const connectDB = async () => {
  try {
    // Use MONGO_URI for tests, otherwise DATABASE_URL
    const mongoUri = process.env.MONGO_URI || process.env.DATABASE_URL;
    if (!mongoUri) {
      logger.error('❌ FATAL ERROR: MONGO_URI or DATABASE_URL is not defined in the .env file.');
      process.exit(1); // Exit with failure
    }

    // Add additional options to handle connection issues
    const conn = await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 5000, // Keep trying to select a server for 5 seconds
      maxPoolSize: 10, // Maintain up to 10 socket connections
      socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
    });
    
    logger.info(`✅ MongoDB Connected: ${conn.connection.host}`);

    // Add listeners for connection-related events
    mongoose.connection.on('error', (err) => {
      logger.error('❌ MongoDB connection error:', { error: err });
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('⚠️ MongoDB disconnected.');
    });
    
    // Warn if using local MongoDB without a replica set (required for transactions)
    if (
      mongoUri.includes('localhost') &&
      !mongoUri.includes('replicaSet')
    ) {
      logger.warn('⚠️ WARNING: Local MongoDB URL does not specify a replicaSet. Transactions may fail.');
    }
    
    return conn;
  } catch (error) {
    logger.error('❌ Error connecting to MongoDB:', {
      errorMessage: error.message,
      error,
    });
    process.exit(1); // Exit with failure since MongoDB is essential for this application
  }
};

export default connectDB;
