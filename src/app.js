import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import mongoSanitize from "express-mongo-sanitize";
import xss from "xss-clean";

import AppError from "./utils/AppError.js";
import globalErrorHandler from "./middleware/errorHandler.js";
import logger from "./utils/logger.js"; // Logging utility

// Routers
import userRouter from "./routes/userRoutes.js";
import taskersRoutes from "./routes/taskersRoutes.js";
import gigRouter from "./routes/gigRoutes.js";
import postRouter from "./routes/postRoutes.js";
import chatRouter from "./routes/chatRoutes.js";
import paymentRouter from "./routes/paymentRoutes.js";
import reviewRouter from "./routes/reviewRoutes.js";
import contractRouter from "./routes/contractRoutes.js";
import applicanceRoutes from "./routes/applicanceRoutes.js"; // Import the applicance routes
import offerRoutes from "./routes/offerRoutes.js"; // Import offer routes

// Stripe Webhook Handler
import { stripeWebhookHandler } from "./controllers/paymentController.js";

// --- App Initialization ---
const app = express();
app.post(
  "/api/v1/payments/webhook",
  express.raw({ type: "application/json" }),
  stripeWebhookHandler
);
logger.info("🚀 Starting Express app...");

// --- Trust Proxy (for Heroku, Nginx, etc.) ---
// app.enable('trust proxy');
// logger.info('✅ Trust proxy enabled'); // commented for now for development test localhost

// --- Stripe Webhook Route (MUST be before body parsers) ---
logger.info("✅ Stripe webhook route mounted");

// --- Global Middleware ---
// Set Security HTTP Headers
app.use(helmet());
logger.info("🛡️ Helmet applied for security headers");

// CORS Configuration
app.use(
  cors({
    origin: "*", // Use env in production
    credentials: true,
  })
);
logger.info(
  `🌐 CORS configured for origin: ${process.env.FRONTEND_URL || "*"}`
);

// Rate Limiting - Avoid abuse
const limiter = rateLimit({
  max: 1000, // Max requests per IP per window
  windowMs: 60 * 60 * 1000, // 1 hour
  message: { status: "fail", message: "Too many requests, try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api", limiter);
logger.info("🚦 Rate limiter applied to /api");

// Body Parsers - Limit size for protection
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true, limit: "10kb" }));
app.use(cookieParser());
logger.info("📦 Body parsers and cookie parser applied");

// Data Sanitization Middleware
app.use(mongoSanitize()); // Prevent NoSQL injection
app.use(xss()); // Prevent XSS attacks
logger.info("🧼 Input sanitization middleware applied");

// --- Routes ---
logger.info("🔗 Mounting API routes...");
app.get("/", (req, res) => res.send("API is running..."));

app.use("/api/v1/applications", applicanceRoutes); // Mount the applicance routes
app.use("/api/v1/users", userRouter);
app.use("/api/v1/taskers", taskersRoutes);
app.use("/api/v1/gigs", gigRouter);
app.use("/api/v1/posts", postRouter);
app.use("/api/v1/chat", chatRouter);
app.use("/api/v1/payments", paymentRouter); // Non-webhook routes
app.use("/api/v1/reviews", reviewRouter);
app.use("/api/v1/contracts", contractRouter);
app.use("/api/v1/offers", offerRoutes); // Use offer routes
logger.info("✅ All routes successfully mounted");

app.get("/favicon.ico", (req, res) => res.status(204).end());

// --- Unhandled Routes Handler ---
app.all("*", (req, res, next) => {
  const message = `Can't find ${req.originalUrl} on this server!`;
  logger.warn(`❌ 404 - ${message}`);
  next(new AppError(message, 404));
});

// --- Global Error Handler ---
app.use(globalErrorHandler);
logger.info("🚨 Global error handler attached");

export default app;
