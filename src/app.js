import dotenv from 'dotenv';
dotenv.config({ path: './.env' });
import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import mongoSanitize from "express-mongo-sanitize";
import xss from "xss-clean";

import AppError from "./utils/AppError.js";
import productionErrorHandler from "./middleware/productionErrorHandler.js";
import logger from "./utils/logger.js";
import { specs, swaggerUi } from "./config/swagger.js";
import { initializeDatabaseSecurity } from "./config/database.js";
import { logSecurityEvent, SECURITY_EVENTS } from "./utils/securityLogger.js";

// Enhanced security middleware
import { securityHeaders, csrfProtection } from "./middleware/securityHeaders.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { 
  apiLimiter, 
  authLimiter, 
  passwordResetLimiter,
  emailVerificationLimiter,
  uploadLimiter 
} from "./middleware/securityValidation.js";
import { sanitizeInput, detectSuspiciousActivity } from "./middleware/securityValidation.js";

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
import offerRouter from "./routes/offerRoutes.js";
import notificationRoutes from './routes/notificationRoutes.js';
import monitoringRoutes from './routes/monitoringRoutes.js';

// Stripe Webhook Handler
import { stripeWebhookHandler } from "./controllers/paymentController.js";

// --- App Initialization ---
const app = express();

// Initialize database security features
initializeDatabaseSecurity();

// --- Security Middleware ---
// Trust proxy for accurate IP addresses
app.set('trust proxy', 1);

// Enhanced helmet configuration
app.use(helmet({
  contentSecurityPolicy: false, // We handle this in securityHeaders middleware
  crossOriginEmbedderPolicy: false // Allow embedding for Stripe
}));

// Custom security headers
app.use(securityHeaders);

// CORS configuration with enhanced security
app.use(cors({
  origin: function (origin, callback) {
    const allowedOrigins = [
      process.env.FRONTEND_URL,
      'http://localhost:3000',
      'http://localhost:5173',
      'http://localhost:3001'
    ].filter(Boolean);
    
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      logger.warn('CORS blocked request from unauthorized origin', { origin });
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Requested-With'],
  exposedHeaders: ['X-Request-ID']
}));

// Request logging for security monitoring
app.use(requestLogger);

// Body parsing with size limits
app.use(express.json({ 
  limit: '10kb',
  verify: (req, res, buf) => {
    // Store raw body for Stripe webhooks
    if (req.originalUrl.includes('/webhook')) {
      req.rawBody = buf;
    }
  }
}));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser());

// Input sanitization
app.use(sanitizeInput);
app.use(mongoSanitize());
app.use(xss());

// Suspicious activity detection
app.use(detectSuspiciousActivity);

// CSRF protection
app.use(csrfProtection);

// Rate limiting - apply different limits to different routes
app.use('/api/v1/users/login', authLimiter);
app.use('/api/v1/users/signup', authLimiter);
app.use('/api/v1/users/forgotPassword', passwordResetLimiter);
app.use('/api/v1/users/resendVerificationEmail', emailVerificationLimiter);
app.use('/api/v1/users/updateMe', uploadLimiter);
app.use('/api/v1/users/me/album', uploadLimiter);
app.use('/api', apiLimiter);

// --- Health Check Endpoint ---
app.get('/health', async (req, res) => {
  try {
    // Basic health check
    const healthData = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV,
      version: process.env.npm_package_version || '1.0.0',
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + ' MB'
      }
    };

    // Check database connection if available
    if (process.env.DATABASE_URI) {
      const mongoose = await import('mongoose');
      healthData.database = {
        status: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        readyState: mongoose.connection.readyState
      };
    }

    res.status(200).json(healthData);
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// --- Security Status Endpoint (Admin only) ---
app.get('/api/v1/security/status', (req, res, next) => {
  // This would typically require admin authentication
  if (process.env.NODE_ENV === 'production' && !req.user?.role?.includes('admin')) {
    return next(new AppError('Access denied', 403));
  }

  const securityStatus = {
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    security: {
      helmet: true,
      cors: true,
      rateLimiting: true,
      inputSanitization: true,
      csrfProtection: true,
      securityHeaders: true,
      requestLogging: true
    },
    features: {
      jwtBlacklisting: true,
      passwordHashing: true,
      emailVerification: true,
      twoFactorAuth: false, // Not implemented yet
      auditLogging: true
    }
  };

  res.status(200).json(securityStatus);
});

// --- API Documentation ---
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs, {
  explorer: true,
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Gig Platform API Documentation'
}));

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
app.use("/api/v1/offers", offerRouter);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/monitoring', monitoringRoutes);

// --- Error Handling ---
app.all('*', (req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

app.use(productionErrorHandler);

export default app;
