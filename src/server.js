// --- Load Environment Variables Early ---
import dotenv from 'dotenv';
dotenv.config({ path: './.env' }); // Ensure all env variables are available from the beginning

// --- Core Imports ---
import mongoose from 'mongoose'; // Needed for DB connection and shutdown
import app from './app.js'; // Main Express app
import connectDB from './config/db.js'; // MongoDB connection logic
import logger from './utils/logger.js'; // Custom logger (e.g., using Winston or Pino)

// --- Handle Uncaught Synchronous Exceptions ---
process.on('uncaughtException', err => {
    logger.error('UNCAUGHT EXCEPTION! 💥 Shutting down...', {
        errorName: err.name,
        errorMessage: err.message,
        stack: err.stack,
    });
    process.exit(1); // Exit immediately, no chance to recover from sync errors
});

// --- Connect to MongoDB ---
connectDB(); // Automatically logs success/failure and handles exit on failure

// --- Start HTTP Server ---
const port = process.env.PORT || 3000;
const server = app.listen(port, () => {
    logger.info(`🚀 Server is running on port ${port} [${process.env.NODE_ENV}]`);
});

// --- Handle Unhandled Promise Rejections ---
process.on('unhandledRejection', err => {
    logger.error('UNHANDLED PROMISE REJECTION! 💥 Shutting down...', {
        errorName: err?.name || 'UnknownError',
        errorMessage: err?.message || 'No message provided',
        stack: err?.stack || 'No stack trace',
    });

    // Attempt graceful shutdown
    server.close(() => {
        logger.info('🛑 Server closed after unhandled rejection.');

        // Close MongoDB connection cleanly
        mongoose.connection.close(false, () => {
            logger.info('📉 MongoDB connection closed.');
            process.exit(1); // Exit with failure code
        });
    });

    // Optional safety timeout: force exit if shutdown hangs
    setTimeout(() => {
        logger.error('⏱ Forcing shutdown due to timeout.');
        process.exit(1);
    }, 10000).unref(); // `unref()` allows process to exit naturally if everything closes early
});

// --- Handle SIGTERM (e.g., from Docker or Cloud Providers) ---
process.on('SIGTERM', () => {
    logger.info('👋 SIGTERM received. Shutting down gracefully...');

    server.close(() => {
        logger.info('🛑 HTTP server closed.');

        mongoose.connection.close(false, () => {
            logger.info('📉 MongoDB connection closed.');
            process.exit(0); // Exit cleanly
        });
    });
});
