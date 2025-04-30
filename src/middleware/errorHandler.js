import AppError from '../utils/AppError.js';

// --- Error Handling Functions for Specific Mongoose/JWT Errors ---

const handleCastErrorDB = (err) => {
  const message = `Invalid ${err.path}: ${err.value}.`;
  return new AppError(message, 400); // 400 Bad Request
};

const handleDuplicateFieldsDB = (err) => {
  // Extract value from the error message using regex
  const value = err.errmsg.match(/(["'])(\\?.)*?\1/)[0];
  const message = `Duplicate field value: ${value}. Please use another value!`;
  return new AppError(message, 400); // 400 Bad Request
};

const handleValidationErrorDB = (err) => {
  // Extract error messages from all validation errors
  const errors = Object.values(err.errors).map(el => el.message);
  const message = `Invalid input data. ${errors.join('. ')}`;
  return new AppError(message, 400); // 400 Bad Request
};

const handleJWTError = () => new AppError('Invalid token. Please log in again!', 401); // 401 Unauthorized

const handleJWTExpiredError = () => new AppError('Your token has expired! Please log in again.', 401); // 401 Unauthorized

// --- Environment-Specific Error Sending Functions ---

const sendErrorDev = (err, res) => {
  // Send detailed error information in development
  res.status(err.statusCode).json({
    status: err.status,
    error: err, // Send full error object
    message: err.message,
    stack: err.stack // Send stack trace
  });
};

const sendErrorProd = (err, res) => {
  // Operational, trusted error: send message to client
  if (err.isOperational) {
    res.status(err.statusCode).json({
      status: err.status,
      message: err.message
    });
  // Programming or other unknown error: don't leak error details
  } else {
    // 1) Log error
    console.error('ERROR 💥', err);
    // 2) Send generic message
    res.status(500).json({
      status: 'error',
      message: 'Something went very wrong!'
    });
  }
};

// --- Global Error Handling Middleware ---

const globalErrorHandler = (err, req, res, next) => {
  // Set default status code and status if not already defined
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  // Determine environment and call appropriate error sending function
  if (process.env.NODE_ENV === 'development') {
    sendErrorDev(err, res);
  } else if (process.env.NODE_ENV === 'production') {
    let error = { ...err }; // Create a copy to avoid modifying original err object
    error.message = err.message; // Ensure message property is copied correctly

    // Handle specific Mongoose/JWT errors and convert them to operational AppErrors
    if (err.name === 'CastError') error = handleCastErrorDB(err); // Invalid ID format
    if (err.code === 11000) error = handleDuplicateFieldsDB(err); // Duplicate key
    if (err.name === 'ValidationError') error = handleValidationErrorDB(err); // Mongoose validation
    if (err.name === 'JsonWebTokenError') error = handleJWTError(); // Invalid JWT signature
    if (err.name === 'TokenExpiredError') error = handleJWTExpiredError(); // Expired JWT

    // Send the processed (or original if not handled above) error in production
    sendErrorProd(error, res);
  }
};

export default globalErrorHandler;