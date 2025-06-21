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

    // Warn if using local MongoDB without a replica set (required for transactions)
    if (
      mongoUri.includes('localhost') &&
      !mongoUri.includes('replicaSet')
    ) {
      logger.warn('⚠️ WARNING: Local MongoDB URL does not specify a replicaSet. Transactions may fail.');
    }

    // Attempt to connect to MongoDB
    const conn = await mongoose.connect(mongoUri);
    logger.info(`✅ MongoDB Connected: ${conn.connection.host}`);

    // Add listeners for connection-related events
    mongoose.connection.on('error', (err) => {
      logger.error('❌ MongoDB connection error:', { error: err });
      process.exit(1);
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('⚠️ MongoDB disconnected.');
    });
  } catch (error) {
    logger.error('❌ Error connecting to MongoDB:', {
      errorMessage: error.message,
      error,
    });
    process.exit(1); // Exit with failure
  }
};

export default connectDB;
