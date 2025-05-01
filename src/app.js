import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser'; // Import cookie-parser for handling cookies
import mongoSanitize from 'express-mongo-sanitize'; // Security: Sanitize input to prevent NoSQL injection
import xss from 'xss-clean'; // Security: Prevent XSS (Cross-Site Scripting) attacks

import AppError from './utils/AppError.js';
import globalErrorHandler from './middleware/errorHandler.js';

// Import Routers
import userRouter from './routes/userRoutes.js';
import gigRouter from './routes/gigRoutes.js';
import postRouter from './routes/postRoutes.js';
import chatRouter from './routes/chatRoutes.js';
import paymentRouter from './routes/paymentRoutes.js'; // Contains non-webhook payment routes
import reviewRouter from './routes/reviewRoutes.js'; // Import review routes for later implementation

// Import Stripe Webhook handler directly
import { stripeWebhookHandler } from './controllers/paymentController.js';

const app = express();

// --- Trust Proxy (if behind a proxy server like nginx or deployed on platforms like Heroku) ---
app.enable('trust proxy');

// --- Webhook Route for Stripe Payments (MUST be before body parsers) ---
/**
 * This route will handle incoming webhooks from Stripe for events such as successful payments, refunds, etc.
 * We use express.raw() to handle raw payload data from Stripe (JSON payload).
 */
app.post('/api/v1/payments/webhook', express.raw({ type: 'application/json' }), stripeWebhookHandler);

// --- Global Middleware (Applied AFTER webhook) ---

// Security Middleware - Helps to prevent security vulnerabilities
app.use(helmet()); // Set security headers to protect the app from common attacks (XSS, etc.)

// CORS Middleware - Set the origin policy for cross-origin requests
app.use(cors({
    origin: '*', // TODO: Restrict in production (use environment variable process.env.FRONTEND_URL)
    credentials: true // Allow cookies if needed across domains
}));

// Rate Limiting Middleware - Protects against DDoS attacks by limiting request rate per IP
const limiter = rateLimit({
  max: 200, // Allow up to 200 requests per hour
  windowMs: 60 * 60 * 1000, // 1 hour window
  message: 'Too many requests from this IP, please try again in an hour!'
});
app.use('/api', limiter); // Apply rate limiting to all API routes

// Body Parsers - Handle incoming request bodies
app.use(express.json({ limit: '10kb' })); // Limit request body size to prevent large payloads
app.use(express.urlencoded({ extended: true, limit: '10kb' })); // URL-encoded data with a limit
app.use(cookieParser()); // Parse cookies in request headers

// Data Sanitization - Protect the app from malicious input
app.use(mongoSanitize()); // Prevent NoSQL query injection by sanitizing input data
app.use(xss()); // Prevent XSS attacks by sanitizing input to remove any harmful scripts

// --- Routes Configuration (Mounting Routes) ---
/**
 * The following routes correspond to the respective feature modules of the application:
 * 1. User Management (authentication, user info)
 * 2. Gig Management (creating, updating, viewing gigs)
 * 3. Post Management (creating, viewing, updating posts)
 * 4. Chat (conversations between users)
 * 5. Payments (creating payment intents, refunds)
 * 6. Reviews (posting and managing reviews)
 */

// API Root Route - For testing if the API is running
app.get('/', (req, res) => res.send('API is running...'));

// Mount User Routes
app.use('/api/v1/users', userRouter); // Handles user-related actions like login, registration, etc.

// Mount Gig Routes
app.use('/api/v1/gigs', gigRouter); // Manages gig listings, including creation, update, deletion

// Mount Post Routes
app.use('/api/v1/posts', postRouter); // Handles user posts (like, comment, share, etc.)

// Mount Chat Routes
app.use('/api/v1/chat', chatRouter); // Manages chat between users (messages, chat history)

// Mount Payment Routes (Excluding Webhook Routes)
app.use('/api/v1/payments', paymentRouter); // Handles payment-related actions like creating intents, refunds

// Mount Review Routes
app.use('/api/v1/reviews', reviewRouter); // Handles review creation, management, and display

// --- Global Error Handling (Fallback for any unmatched routes) ---

/**
 * Catch-all route for handling 404 errors when no route matches the requested URL.
 * It will pass an AppError to the error handler to respond with an appropriate error message.
 */
app.all('*', (req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

/**
 * Global error handler middleware to catch all errors and format them
 * before sending the response. It ensures a consistent error response structure.
 */
app.use(globalErrorHandler);

export default app;
