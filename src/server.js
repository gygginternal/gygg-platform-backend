import dotenv from 'dotenv';
// Load environment variables from .env file
dotenv.config({ path: './.env' });

import mongoose from 'mongoose'; // Mongoose is required for graceful shutdown
import app from './app.js'; // The main Express app
import connectDB from './config/db.js'; // Database connection function

// --- Handle Uncaught Exceptions (Sync Errors) ---
process.on('uncaughtException', (err) => {
    console.log('UNCAUGHT EXCEPTION! 💥 Shutting down...');
    console.error(err.name, err.message); // Log error name and message
    console.error(err); // Log the full error object for better context
    process.exit(1); // Exit process with a failure code (1) to indicate the error
});

// --- Database Connection ---
connectDB(); // Connect to MongoDB database (handles its own errors and exits if failure)

// --- Start the Server ---
const port = process.env.PORT || 3000; // Default port is 3000 if not specified in .env
const server = app.listen(port, () => {
    console.log(`App running on port ${port}... (Mode: ${process.env.NODE_ENV})`);
});

// --- Handle Unhandled Promise Rejections (Async Errors) ---
process.on('unhandledRejection', (err) => {
    console.log('UNHANDLED REJECTION! 💥 Shutting down...');
    console.error(err.name, err.message); // Log error name and message
    console.error(err); // Log the full error for debugging

    // Gracefully shut down the server to ensure all requests are finished
    server.close(() => {
        process.exit(1); // Exit after server is closed
    });
});

// --- Handle SIGTERM for Graceful Shutdown (e.g., from Heroku/Docker) ---
process.on('SIGTERM', () => {
    console.log('👋 SIGTERM RECEIVED. Shutting down gracefully...');
    server.close(() => {
        console.log('💥 Process terminated!');
        
        // Close MongoDB connection gracefully before exiting
        mongoose.connection.close(false, () => {
            console.log('MongoDB connection closed.');
            process.exit(0); // Exit process cleanly with code 0 (success)
        });
    });
});
