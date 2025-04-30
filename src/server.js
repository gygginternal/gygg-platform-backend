import dotenv from 'dotenv';
import app from './app.js'; // Import the configured Express app
import connectDB from './config/db.js'; // Import the DB connection function

// Configure dotenv to load environment variables
// Important: Load config before other imports that might need process.env
dotenv.config({ path: './.env' });

// --- Handle Uncaught Exceptions (Sync Errors) ---
// Should be placed at the very top to catch early errors
process.on('uncaughtException', err => {
  console.log('UNCAUGHT EXCEPTION! 💥 Shutting down...');
  console.log(err.name, err.message);
  // Shut down gracefully, giving the server time to finish requests (optional)
  // Consider logging the error before exiting
  process.exit(1); // Exit immediately (required for uncaught sync errors)
});


// --- Database Connection ---
connectDB();

// --- Start Server ---
const port = process.env.PORT || 3000; // Use port from .env or default to 3000
const server = app.listen(port, () => {
  console.log(`App running on port ${port}... (Mode: ${process.env.NODE_ENV})`);
});

// --- Handle Unhandled Promise Rejections (Async Errors) ---
process.on('unhandledRejection', err => {
  console.log('UNHANDLED REJECTION! 💥 Shutting down...');
  console.log(err.name, err.message);
  // Close server gracefully, allowing pending requests to finish
  server.close(() => {
    // Consider logging the error before exiting
    process.exit(1); // Exit after server is closed
  });
});

// --- Handle SIGTERM for graceful shutdown (e.g., from Heroku/Docker) ---
process.on('SIGTERM', () => {
  console.log('👋 SIGTERM RECEIVED. Shutting down gracefully');
  server.close(() => {
    console.log('💥 Process terminated!');
    // No need to process.exit(1) here, SIGTERM implies shutdown
  });
});