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

// Trust proxy when running behind reverse proxy like Ngrok
app.set('trust proxy', 1);

// Add timeout protection middleware to prevent slowloris and similar attacks
app.use((req, res, next) => {
  // Set request timeout to prevent hanging connections
  req.setTimeout(30000, () => { // 30 seconds timeout
    req.destroy();
  });
  
  // Prevent large payloads through headers
  if (req.headers['content-length']) {
    const contentLength = parseInt(req.headers['content-length'], 10);
    if (contentLength > 10 * 1024) { // 10KB limit
      return res.status(413).json({
        status: 'fail',
        message: 'Request entity too large'
      });
    }
  }
  
  next();
});

// --- Security Middleware ---
app.use(helmet({
  hsts: {
    maxAge: 31536000, // 1 year in seconds
    includeSubDomains: true,
    preload: true,
  },
  frameguard: {
    action: 'deny',
  },
  contentSecurityPolicy: {
    directives: {
      'default-src': ["'self'"],
      'style-src': ["'self'", "'unsafe-inline'"],
      'script-src': ["'self'"],
      'img-src': ["'self'", "data:", "https:"],
      'connect-src': ["'self'", "https://*.s3.amazonaws.com"], // Allow S3 connections
      'font-src': ["'self'", "https:", "data:"],
      'object-src': ["'none'"], // Prevent embedding plugins
      'upgrade-insecure-requests': [],
    },
  },
  referrerPolicy: {
    policy: 'no-referrer',
  },
  permittedCrossDomainPolicies: {
    permittedPolicies: 'none',
  },
  // Additional security measures
  hidePoweredBy: true, // Hide X-Powered-By header
})); // Set security HTTP headers

// --- Enhanced Security Headers ---
import { securityHeaders } from './middleware/monitoring.js';
app.use(securityHeaders); // Add additional security headers
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
// Enhanced body parser with comprehensive limits and timeout protection
app.use(express.json({ 
  limit: '10kb',
  // Add timeout protection for slowloris and similar attacks
  verify: (req, res, buf, encoding) => {
    // Check for abnormally large content lengths
    if (req.headers['content-length'] && parseInt(req.headers['content-length']) > 10240) {
      throw new Error('Request entity too large');
    }
  }
})); 

// Enhanced URL encoding limit for query strings and URL parameters
app.use(express.urlencoded({ 
  extended: true, 
  limit: '10kb',
  parameterLimit: 100 // Limit number of parameters to prevent hash flooding
}));

app.use(cookieParser()); // Parse cookies
app.use(mongoSanitize()); // Sanitize data against NoSQL query injection
app.use(xss()); // Sanitize data against XSS

// Global rate limiter for all requests
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Authentication-specific rate limiter (more restrictive)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // only allow 5 failed attempts per IP
  message: 'Too many authentication attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// File upload rate limiter
const fileUploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // limit each IP to 10 file uploads per hour
  message: 'Too many file uploads from this IP, please try again later.',
});

// Apply global rate limiter to all requests
app.use(globalLimiter);

// Apply specific rate limiting to authentication routes
app.use("/api/v1/users/login", authLimiter);
app.use("/api/v1/users/signup", authLimiter);
app.use("/api/v1/users/forgotPassword", authLimiter);
app.use("/api/v1/users/resetPassword", authLimiter);
app.use("/api/v1/users/verifyEmail", authLimiter);

// Apply file upload rate limiting to chat image uploads
app.use("/api/v1/chat/upload-image", fileUploadLimiter);

// General API rate limiting (in addition to global limiter)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs for API
  message: "Too many requests from this IP to the API, please try again later!",
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api", apiLimiter);

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

// --- Nuvei Webhook Handler (needs raw body) ---
app.post(
  "/api/v1/payments/webhook/nuvei",
  express.raw({ type: "application/json" }),
  (req, res, next) => {
    // Convert raw body to JSON for Nuvei webhook handler
    if (req.body && typeof req.body === 'string') {
      try {
        req.body = JSON.parse(req.body);
      } catch (err) {
        return next(new AppError('Invalid JSON in request body', 400));
      }
    }
    // Import the function directly since we're using ES modules in the controller
    import('./controllers/paymentController.js')
      .then(controllerModule => {
        const { handleNuveiWebhook } = controllerModule;
        return handleNuveiWebhook(req, res, next);
      })
      .catch(err => next(err));
  }
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
