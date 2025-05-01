// src/config/db.js

import mongoose from 'mongoose';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config({ path: './.env' });

/**
 * Establishes a connection to MongoDB using Mongoose.
 * Includes safety checks for missing environment variables and replica set usage.
 */
const connectDB = async () => {
  try {
    // Check if DATABASE_URL is defined in environment variables
    if (!process.env.DATABASE_URL) {
      console.error('❌ FATAL ERROR: DATABASE_URL is not defined in the .env file.');
      process.exit(1); // Exit with failure
    }

    // Warn if using local MongoDB without a replica set (required for transactions)
    if (
      process.env.DATABASE_URL.includes('localhost') &&
      !process.env.DATABASE_URL.includes('replicaSet')
    ) {
      console.warn('⚠️ WARNING: Local MongoDB URL does not specify a replicaSet. Transactions may fail.');
    }

    // Attempt to connect to MongoDB
    const conn = await mongoose.connect(process.env.DATABASE_URL);

    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);

    // Optional: Add listeners for connection-related events
    mongoose.connection.on('error', (err) => {
      console.error(`❌ MongoDB connection error: ${err}`);
      process.exit(1); // Exit on critical connection errors
    });

    mongoose.connection.on('disconnected', () => {
      console.warn('⚠️ MongoDB disconnected.');
    });
  } catch (error) {
    console.error('❌ Error connecting to MongoDB: ', error.message);
    console.error(error); // Log full error for debugging
    process.exit(1); // Exit with failure
  }
};

export default connectDB;
