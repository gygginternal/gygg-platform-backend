import mongoose from 'mongoose';
import AppError from './AppError.js';
import logger from './logger.js';

/**
 * Generic function to find a document by ID with proper error handling
 * @param {mongoose.Model} Model - The Mongoose model
 * @param {string} id - The document ID
 * @param {string} errorMessage - Custom error message
 * @returns {Promise<Document>} The found document
 * @throws {AppError} If document not found or invalid ID
 */
export const findDocumentById = async (Model, id, errorMessage = 'Document not found', timeoutMs = 10000) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError('Invalid ID format', 400);
  }
  
  // Add query timeout to prevent hanging requests
  const doc = await Model.findById(id).maxTimeMS(timeoutMs);
  if (!doc) {
    throw new AppError(errorMessage, 404);
  }
  
  return doc;
};

/**
 * Generic function to find a document by ID with population
 * @param {mongoose.Model} Model - The Mongoose model
 * @param {string} id - The document ID
 * @param {string|Object} populateFields - Fields to populate
 * @param {string} errorMessage - Custom error message
 * @returns {Promise<Document>} The found document with populated fields
 */
export const findDocumentByIdWithPopulate = async (Model, id, populateFields, errorMessage = 'Document not found', timeoutMs = 10000) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError('Invalid ID format', 400);
  }
  
  const doc = await Model.findById(id).populate(populateFields).maxTimeMS(timeoutMs);
  if (!doc) {
    throw new AppError(errorMessage, 404);
  }
  
  return doc;
};

/**
 * Generic function to update a document by ID
 * @param {mongoose.Model} Model - The Mongoose model
 * @param {string} id - The document ID
 * @param {Object} updateData - Data to update
 * @param {Object} options - Update options
 * @param {string} errorMessage - Custom error message
 * @returns {Promise<Document>} The updated document
 */
export const updateDocumentById = async (Model, id, updateData, options = { new: true, runValidators: true }, errorMessage = 'Document not found', timeoutMs = 10000) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError('Invalid ID format', 400);
  }
  
  const doc = await Model.findByIdAndUpdate(id, updateData, { ...options, maxTimeMS: timeoutMs });
  if (!doc) {
    throw new AppError(errorMessage, 404);
  }
  
  return doc;
};

/**
 * Generic function to delete a document by ID
 * @param {mongoose.Model} Model - The Mongoose model
 * @param {string} id - The document ID
 * @param {string} errorMessage - Custom error message
 * @returns {Promise<Document>} The deleted document
 */
export const deleteDocumentById = async (Model, id, errorMessage = 'Document not found', timeoutMs = 10000) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError('Invalid ID format', 400);
  }
  
  const doc = await Model.findByIdAndDelete(id).maxTimeMS(timeoutMs);
  if (!doc) {
    throw new AppError(errorMessage, 404);
  }
  
  return doc;
};

/**
 * Execute multiple operations within a database transaction
 * @param {Function} operations - Async function containing operations to execute
 * @returns {Promise<any>} Result of the operations
 */
export const withTransaction = async (operations) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const result = await operations(session);
    await session.commitTransaction();
    logger.info('Transaction committed successfully');
    return result;
  } catch (error) {
    await session.abortTransaction();
    logger.error('Transaction aborted due to error:', error);
    throw error;
  } finally {
    session.endSession();
  }
};

/**
 * Check if user has permission to access/modify a resource
 * @param {Object} resource - The resource document
 * @param {string} userId - The user ID
 * @param {string} resourceField - Field name that contains the owner ID (default: 'user')
 * @param {string} errorMessage - Custom error message
 * @throws {AppError} If user doesn't have permission
 */
export const checkResourceOwnership = (resource, userId, resourceField = 'user', errorMessage = 'Access denied') => {
  const resourceOwnerId = resource[resourceField]?.toString() || resource[resourceField];
  if (resourceOwnerId !== userId.toString()) {
    throw new AppError(errorMessage, 403);
  }
};

/**
 * Paginate query results
 * @param {mongoose.Query} query - The mongoose query
 * @param {number} page - Page number (default: 1)
 * @param {number} limit - Items per page (default: 10)
 * @returns {Object} Paginated results with metadata
 */
export const paginateResults = async (query, page = 1, limit = 10, timeoutMs = 10000) => {
  const skip = (page - 1) * limit;
  // Add timeout to both the main query and count query
  const resultsPromise = query.skip(skip).limit(limit).maxTimeMS(timeoutMs);
  const countQuery = query.model.countDocuments(query.getQuery()).maxTimeMS(timeoutMs);
  
  const [results, total] = await Promise.all([resultsPromise, countQuery]);
  
  return {
    results,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
      hasNext: page < Math.ceil(total / limit),
      hasPrev: page > 1
    }
  };
};