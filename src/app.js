import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser'; // Import cookie-parser
import AppError from './utils/AppError.js';
import globalErrorHandler from './middleware/errorHandler.js';

// Import Routers
import userRouter from './routes/userRoutes.js';
import gigRouter from './routes/gigRoutes.js'; // Import Gig router
import postRouter from './routes/postRoutes.js'; // Import Post router
import chatRouter from './routes/chatRoutes.js'; // Import Chat router

// Initialize Express app
const app = express();

// --- Global Middleware ---
app.use(helmet());
app.use(cors({
    origin: '*', // Adjust for production
    // credentials: true // Uncomment if using cookies across domains
}));

const limiter = rateLimit({
  max: 100,
  windowMs: 60 * 60 * 1000,
  message: 'Too many requests from this IP, please try again in an hour!'
});
app.use('/api', limiter);

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser()); // Add cookie parser middleware HERE, before routes

// --- Routes ---
app.get('/', (req, res) => {
  res.send('API is running...');
});

// Mount routers
app.use('/api/v1/users', userRouter); // Mount user/auth routes under /api/v1/users
app.use('/api/v1/gigs', gigRouter); // Mount gig routes
app.use('/api/v1/posts', postRouter); // Mount post routes
app.use('/api/v1/chat', chatRouter); // Mount chat routes under /api/v1/chat

// --- Error Handling ---
app.all('*', (req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

app.use(globalErrorHandler);

export default app;