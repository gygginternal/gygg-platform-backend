import dotenv from "dotenv";
dotenv.config({ path: "./.env" });
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
import { specs, swaggerUi } from "./config/swagger.js";

// Routers
import userRouter from "./routes/userRoutes.js";
import taskersRouter from "./routes/taskersRoutes.js";
import gigRouter from "./routes/gigRoutes.js";
import postRouter from "./routes/postRoutes.js";
import chatRouter from "./routes/chatRoutes.js";
import paymentRouter from "./routes/paymentRoutes.js";
import reviewRouter from "./routes/reviewRoutes.js";
import contractRouter from "./routes/contractRoutes.js";
import applicationRouter from "./routes/applicationRoutes.js";

import timeTrackingRouter from "./routes/timeTrackingRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";

// Stripe Webhook Handler
import { stripeWebhookHandler } from "./controllers/paymentController.js";
import { startTokenCleanupJob } from "./utils/tokenCleanup.js";

// --- App Initialization ---
const app = express();

// --- Security Middleware ---
app.use(helmet()); // Set security HTTP headers
// Dynamic CORS configuration
const getAllowedOrigins = () => {
  const origins = [
    "http://localhost:3000",
    "http://localhost:5173", 
    "http://localhost:3001"
  ];
  
  // Add CORS_URL if it's defined and not empty
  if (process.env.CORS_URL && process.env.CORS_URL.trim() !== '') {
    origins.push(process.env.CORS_URL);
  }
  
  // Add environment-specific frontend URL if different from hardcoded ones
  if (process.env.FRONTEND_URL && !origins.includes(process.env.FRONTEND_URL)) {
    origins.push(process.env.FRONTEND_URL);
  }
  
  // Add any additional frontend URLs from environment (comma-separated)
  if (process.env.ADDITIONAL_FRONTEND_URLS) {
    const additionalUrls = process.env.ADDITIONAL_FRONTEND_URLS.split(',').map(url => url.trim());
    origins.push(...additionalUrls);
  }
  
  return origins;
};

app.use(
  cors({
    origin: function (origin, callback) {
      const allowedOrigins = getAllowedOrigins();
      
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);
      
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      } else {
        logger.warn(`CORS blocked request from origin: ${origin}`);
        logger.info(`Allowed origins: ${allowedOrigins.join(', ')}`);
        return callback(new Error('Not allowed by CORS'), false);
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Cookie", "X-Requested-With", "X-Embedded-Onboarding"],
    optionsSuccessStatus: 200,
    preflightContinue: false,
  })
);
app.use(express.json({ limit: "10kb" })); // Body parser, reading data from body into req.body
app.use(cookieParser()); // Parse cookies
app.use(mongoSanitize()); // Sanitize data against NoSQL query injection
app.use(xss()); // Sanitize data against XSS

// Rate limiting
const limiter = rateLimit({
  max: 1000, // Limit each IP to 1000 requests per windowMs
  windowMs: 60 * 60 * 1000, // 1 hour
  message: "Too many requests from this IP, please try again in an hour!",
});
app.use("/api", limiter);

// --- Health Check Endpoint ---
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
    version: process.env.npm_package_version || "1.0.0",
  });
});

// --- API Documentation ---
app.use(
  "/api-docs",
  swaggerUi.serve,
  swaggerUi.setup(specs, {
    explorer: true,
    customCss: ".swagger-ui .topbar { display: none }",
    customSiteTitle: "Gig Platform API Documentation",
  })
);

// --- Stripe Webhook Handler (needs raw body) ---
app.post(
  "/api/v1/payments/webhook",
  express.raw({ type: "application/json" }),
  stripeWebhookHandler
);

// --- Mount Routers ---
app.use("/api/v1/users", userRouter);
app.use("/api/v1/taskers", taskersRouter);
app.use("/api/v1/gigs", gigRouter);
app.use("/api/v1/posts", postRouter);
app.use("/api/v1/chat", chatRouter);
app.use("/api/v1/payments", paymentRouter);
app.use("/api/v1/reviews", reviewRouter);
app.use("/api/v1/contracts", contractRouter);
app.use("/api/v1/applications", applicationRouter);
app.use("/api/v1/time-tracking", timeTrackingRouter);
app.use("/api/v1/notifications", notificationRoutes);

// --- API Base Route ---
app.get("/api/v1", (req, res) => {
  res.status(200).json({
    status: "success",
    message: "Gig Platform API v1",
    version: "1.0.0",
    endpoints: {
      users: "/api/v1/users",
      gigs: "/api/v1/gigs",
      posts: "/api/v1/posts",
      chat: "/api/v1/chat",
      payments: "/api/v1/payments",
      reviews: "/api/v1/reviews",
      contracts: "/api/v1/contracts",
      applications: "/api/v1/applications",
      notifications: "/api/v1/notifications",
    },
  });
});

// --- Error Handling ---
app.all("*", (req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

app.use(globalErrorHandler);

export default app;
