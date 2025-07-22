/**
 * Send success response with data
 * @param {Object} res - Express response object
 * @param {number} statusCode - HTTP status code
 * @param {any} data - Response data
 * @param {string} message - Optional success message
 * @param {Object} meta - Optional metadata (pagination, etc.)
 */
export const sendSuccessResponse = (res, statusCode = 200, data = null, message = null, meta = null) => {
  const response = {
    status: 'success',
    ...(message && { message }),
    ...(data && { data }),
    ...(meta && { meta })
  };

  res.status(statusCode).json(response);
};

/**
 * Send paginated response
 * @param {Object} res - Express response object
 * @param {Object} paginatedData - Data from paginateResults helper
 * @param {string} dataKey - Key name for the data array
 * @param {string} message - Optional message
 */
export const sendPaginatedResponse = (res, paginatedData, dataKey = 'items', message = null) => {
  const response = {
    status: 'success',
    ...(message && { message }),
    results: paginatedData.results.length,
    data: {
      [dataKey]: paginatedData.results
    },
    pagination: paginatedData.pagination
  };

  res.status(200).json(response);
};

/**
 * Send created response (201)
 * @param {Object} res - Express response object
 * @param {any} data - Created resource data
 * @param {string} message - Optional success message
 */
export const sendCreatedResponse = (res, data, message = 'Resource created successfully') => {
  sendSuccessResponse(res, 201, data, message);
};

/**
 * Send no content response (204)
 * @param {Object} res - Express response object
 */
export const sendNoContentResponse = (res) => {
  res.status(204).json({
    status: 'success',
    data: null
  });
};

/**
 * Send error response
 * @param {Object} res - Express response object
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @param {any} errors - Optional detailed errors
 */
export const sendErrorResponse = (res, statusCode = 500, message = 'Internal server error', errors = null) => {
  const response = {
    status: 'error',
    message,
    ...(errors && { errors })
  };

  res.status(statusCode).json(response);
};