/**
 * Utility function to catch async errors in route handlers and forward them to the global error handler.
 * @param {Function} fn - The async function (typically a controller).
 * @returns {Function} Wrapped function that automatically forwards errors.
 */
const catchAsync = fn => {
  return (req, res, next) => {
    fn(req, res, next).catch(next); // Forward errors to Express error handling middleware
  };
};

export default catchAsync;
