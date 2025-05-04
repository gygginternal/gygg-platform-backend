// utils/globalErrorHandler.js

import AppError from '../utils/AppError.js';
import logger from '../utils/logger.js'; // Centralized logger

/* -------------------------------------------------------------------------- */
/*                         Specific Error Type Handlers                       */
/* -------------------------------------------------------------------------- */

/**
 * Handles MongoDB CastError (e.g., malformed ObjectId)
 */
const handleCastErrorDB = (err) => 
  new AppError(`Invalid ${err.path}: ${err.value}.`, 400);

/**
 * Handles MongoDB duplicate field errors (code 11000)
 */
const handleDuplicateFieldsDB = (err) => {
  const valueMatch = err.message.match(/(["'])(?:(?=(\\?))\2.)*?\1/);
  const value = valueMatch ? valueMatch[0] : 'value';
  return new AppError(`Duplicate field ${value}. Please use another value!`, 400);
};

/**
 * Handles Mongoose validation errors (e.g., missing required fields)
 */
const handleValidationErrorDB = (err) => {
  const errors = Object.values(err.errors).map((el) => el.message);
  return new AppError(`Invalid input data. ${errors.join('. ')}`, 400);
};

/**
 * Handles invalid JWT tokens
 */
const handleJWTError = () =>
  new AppError('Invalid token. Please log in again!', 401);

/**
 * Handles expired JWT tokens
 */
const handleJWTExpiredError = () =>
  new AppError('Your token has expired! Please log in again.', 401);

/* -------------------------------------------------------------------------- */
/*                         Error Response Formatters                          */
/* -------------------------------------------------------------------------- */

/**
 * Sends detailed error info in development environment
 */
const sendErrorDev = (err, req, res) => {
  logger.error('DEVELOPMENT ERROR 💥', {
    message: err.message,
    status: err.status,
    statusCode: err.statusCode,
    isOperational: err.isOperational,
    stack: err.stack,
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
  });

  res.status(err.statusCode).json({
    status: err.status,
    error: err,
    message: err.message,
    stack: err.stack,
  });
};

/**
 * Sends limited error info in production environment
 */
const sendErrorProd = (err, req, res) => {
  // Operational (trusted) error: send clear message to client
  if (err.isOperational) {
    logger.warn('OPERATIONAL ERROR 🚨', {
      url: req.originalUrl,
      method: req.method,
      statusCode: err.statusCode,
      message: err.message,
      ip: req.ip,
    });

    res.status(err.statusCode).json({
      status: err.status,
      message: err.message,
    });

  // Programming or unknown error: log it and send generic message
  } else {
    logger.error('UNKNOWN ERROR 💥', {
      url: req.originalUrl,
      method: req.method,
      errorMessage: err.message,
      stack: err.stack,
      ip: req.ip,
    });

    res.status(500).json({
      status: 'error',
      message: 'Something went very wrong!',
    });
  }
};

/* -------------------------------------------------------------------------- */
/*                       Global Error Handling Middleware                     */
/* -------------------------------------------------------------------------- */

/**
 * Global Express error handler middleware
 */
const globalErrorHandler = (err, req, res, next) => {
  // Set default error properties if not already set
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  // Development: show full error details
  if (process.env.NODE_ENV === 'development') {
    sendErrorDev(err, req, res);

  // Production: handle known errors, mask unknown ones
  } else if (process.env.NODE_ENV === 'production') {
    let error = { ...err }; // Shallow copy
    error.message = err.message; // Ensure message is not lost

    // Convert specific error types into operational errors
    if (err.name === 'CastError') error = handleCastErrorDB(err);
    if (err.code === 11000) error = handleDuplicateFieldsDB(err);
    if (err.name === 'ValidationError') error = handleValidationErrorDB(err);
    if (err.name === 'JsonWebTokenError') error = handleJWTError();
    if (err.name === 'TokenExpiredError') error = handleJWTExpiredError();

    sendErrorProd(error, req, res);
  }
};

export default globalErrorHandler;
