import dotenv from 'dotenv';
dotenv.config({ path: './.env' });
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

// Stripe Webhook Handler
import { stripeWebhookHandler } from "./controllers/paymentController.js";

// --- App Initialization ---
const app = express();

// --- Security Middleware ---
app.use(helmet()); // Set security HTTP headers
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:3001'
  ],
  credentials: true
}));
app.use(express.json({ limit: '10kb' })); // Body parser, reading data from body into req.body
app.use(cookieParser()); // Parse cookies
app.use(mongoSanitize()); // Sanitize data against NoSQL query injection
app.use(xss()); // Sanitize data against XSS

// Rate limiting
const limiter = rateLimit({
  max: 1000, // Limit each IP to 1000 requests per windowMs
  windowMs: 60 * 60 * 1000, // 1 hour
  message: 'Too many requests from this IP, please try again in an hour!'
});
app.use('/api', limiter);

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

// --- Error Handling ---
app.all('*', (req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

app.use(globalErrorHandler);

export default app;
