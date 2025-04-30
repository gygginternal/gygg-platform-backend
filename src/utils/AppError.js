class AppError extends Error {
    constructor(message, statusCode) {
      super(message); // Call parent constructor (Error)
  
      this.statusCode = statusCode;
      // Determine status based on statusCode (fail for 4xx, error for 5xx)
      this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
      // Differentiate operational errors (trusted) from programming errors
      this.isOperational = true;
  
      // Capture stack trace, excluding constructor call from it
      Error.captureStackTrace(this, this.constructor);
    }
  }
  
  export default AppError;