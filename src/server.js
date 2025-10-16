// --- Load Environment Variables Early ---
import dotenv from "dotenv";
dotenv.config({ path: "./.env" }); // Ensure all env variables are available from the beginning

// --- Core Imports ---
import mongoose from "mongoose"; // Needed for DB connection and shutdown
import app from './app.js'; // Main Express app
import connectDB from "./config/db.js"; // MongoDB connection logic
import logger from "./utils/logger.js"; // Custom logger (e.g., using Winston or Pino)
import http from "http"; // Needed to create an HTTP server for WebSocket integration
import { initializeChatWebsocket } from "./controllers/chatWebsocket.js"; // Import chat WebSocket logic
import { setChatWebsocket } from './controllers/chatController.js';
import { startTokenCleanupJob } from './utils/tokenCleanup.js'; // Import the token cleanup job

// Import Redis client
import redisClient from './config/redis.js';

// --- Handle Uncaught Synchronous Exceptions ---
process.on("uncaughtException", (err) => {
  logger.error("UNCAUGHT EXCEPTION! 💥 Shutting down...", {
    errorName: err.name,
    errorMessage: err.message,
    stack: err.stack,
  });
  process.exit(1); // Exit immediately, no chance to recover from sync errors
});

// --- Connect to MongoDB and start token cleanup job after connection ---
connectDB().then(async () => {
  // Connect to Valkey
  try {
    await redisClient.connect();
    logger.info('✅ Valkey client connected');
  } catch (valkeyError) {
    logger.error('❌ Failed to connect to Valkey:', valkeyError);
  }
  
  // Start token cleanup job only after database connection is established
  if (process.env.NODE_ENV !== 'test') {
    startTokenCleanupJob();
  }
}).catch(error => {
  logger.error('Failed to connect to MongoDB:', error);
  process.exit(1);
}); // Automatically logs success/failure and handles exit on failure

// --- Create HTTP Server ---
const PORT = process.env.PORT || 5000;
const server = http.createServer(app); // Use the Express app to create an HTTP server

// Add timeout protection to prevent slowloris attacks
server.setTimeout(30000); // 30 seconds timeout for HTTP requests
server.headersTimeout = 25000; // 25 seconds for headers
server.requestTimeout = 20000; // 20 seconds for request

// --- Initialize Chat WebSocket Server ---
const chatWebsocket = initializeChatWebsocket(server);
setChatWebsocket(chatWebsocket);

// --- Start HTTP Server ---
if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => {
    logger.info(`🚀 Server is running on port ${PORT} [${process.env.NODE_ENV}]`);
  });
}

// --- Handle Unhandled Promise Rejections ---
process.on("unhandledRejection", (err) => {
  logger.error("UNHANDLED PROMISE REJECTION! 💥 Shutting down...", {
    errorName: err?.name || "UnknownError",
    errorMessage: err?.message || "No message provided",
    stack: err?.stack || "No stack trace",
  });

  // Attempt graceful shutdown
  server.close(async () => {
    logger.info("🛑 Server closed after unhandled rejection.");

    try {
      await mongoose.connection.close(false);
      logger.info("📉 MongoDB connection closed.");
      
      // Close Valkey connection
      if (redisClient) {
        await redisClient.quit();
        logger.info("✅ Valkey connection closed.");
      }
    } catch (closeError) {
      logger.error("Error closing connections:", closeError);
    } finally {
      process.exit(1); // Exit with failure code
    }
  });

  setTimeout(() => {
    logger.error("⏱ Forcing shutdown due to timeout.");
    process.exit(1);
  }, 10000).unref();
});

// --- Handle SIGTERM (e.g., from Docker or Cloud Providers) ---
process.on("SIGTERM", () => {
  logger.info("👋 SIGTERM received. Shutting down gracefully...");

  server.close(async () => {
    logger.info("🛑 HTTP server closed.");

    try {
      await mongoose.connection.close(false);
      logger.info("📉 MongoDB connection closed.");
      
      // Close Valkey connection
      if (redisClient) {
        await redisClient.quit();
        logger.info("✅ Valkey connection closed.");
      }
    } catch (closeError) {
      logger.error("Error closing connections:", closeError);
    } finally {
      process.exit(0); // Exit cleanly
    }
  });
});
