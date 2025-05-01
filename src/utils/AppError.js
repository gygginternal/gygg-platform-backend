// Custom error class for handling operational errors in a structured way
class AppError extends Error {
  /**
   * Constructs a new AppError instance.
   * @param {string} message - A human-readable error message.
   * @param {number} statusCode - The HTTP status code (e.g., 404, 500).
   */
  constructor(message, statusCode) {
    // Call the parent class (Error) constructor
    super(message);

    // Store the HTTP status code
    this.statusCode = statusCode;

    // Determine error status: 'fail' for 4xx, 'error' for 5xx and others
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';

    // Mark this error as operational (trusted) — not a programming bug
    this.isOperational = true;

    // Capture the stack trace, excluding the constructor call from it
    Error.captureStackTrace(this, this.constructor);
  }
}

// Export the AppError class for use in other files
export default AppError;
