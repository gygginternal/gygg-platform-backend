// utils/globalErrorHandler.js

import AppError from '../utils/AppError.js';

// --- Specific Error Handlers ---

// Handles invalid MongoDB ObjectID (e.g., malformed _id)
const handleCastErrorDB = (err) =>
  new AppError(`Invalid ${err.path}: ${err.value}.`, 400);

// Handles duplicate field errors from MongoDB
const handleDuplicateFieldsDB = (err) => {
  // Use regex to safely extract duplicated value from error message
  const valueMatch = err.message.match(/(["'])(?:(?=(\\?))\2.)*?\1/);
  const value = valueMatch ? valueMatch[0] : 'value'; // Fallback if no match

  const message = `Duplicate field ${value}. Please use another value!`;
  return new AppError(message, 400);
};

// Handles Mongoose validation errors (e.g., required field missing)
const handleValidationErrorDB = (err) => {
  const errors = Object.values(err.errors).map((el) => el.message);
  const message = `Invalid input data. ${errors.join('. ')}`;
  return new AppError(message, 400);
};

// Handles invalid JWT token
const handleJWTError = () =>
  new AppError('Invalid token. Please log in again!', 401);

// Handles expired JWT token
const handleJWTExpiredError = () =>
  new AppError('Your token has expired! Please log in again.', 401);

// --- Error Response Formatters ---

// Sends full error details in development environment
const sendErrorDev = (err, res) => {
  console.error('DEVELOPMENT ERROR 💥:', err);

  res.status(err.statusCode).json({
    status: err.status,
    error: err,
    message: err.message,
    stack: err.stack,
  });
};

// Sends concise error message in production environment
const sendErrorProd = (err, res) => {
  // Operational (trusted) error: show message to client
  if (err.isOperational) {
    res.status(err.statusCode).json({
      status: err.status,
      message: err.message,
    });
  } else {
    // Unknown or programming error: log and send generic message
    console.error('PRODUCTION ERROR 💥:', err);

    res.status(500).json({
      status: 'error',
      message: 'Something went very wrong!',
    });
  }
};

// --- Global Error Handling Middleware ---

const globalErrorHandler = (err, req, res, next) => {
  // Set default values if missing
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  // Send detailed error in development mode
  if (process.env.NODE_ENV === 'development') {
    sendErrorDev(err, res);

  // Handle known errors and send generic messages in production
  } else if (process.env.NODE_ENV === 'production') {
    let error = { ...err }; // Clone to avoid mutating the original
    error.message = err.message; // Ensure message is preserved

    // Handle specific known errors
    if (err.name === 'CastError') error = handleCastErrorDB(err);
    if (err.code === 11000) error = handleDuplicateFieldsDB(err);
    if (err.name === 'ValidationError') error = handleValidationErrorDB(err);
    if (err.name === 'JsonWebTokenError') error = handleJWTError();
    if (err.name === 'TokenExpiredError') error = handleJWTExpiredError();

    // Send response
    sendErrorProd(error, res);
  }
};

export default globalErrorHandler;
