import { s3Client } from '../config/s3Config.js';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import logger from './logger.js';

/**
 * Delete an S3 object by key
 * @param {string} key - S3 object key
 * @param {string} bucketName - S3 bucket name (optional, uses env var if not provided)
 * @returns {Promise<void>}
 */
const deleteS3Object = async (key, bucketName = process.env.AWS_S3_BUCKET_NAME) => {
  if (!key || key === 'default.jpg') {
    logger.debug(`deleteS3Object: No valid key or key is default. Key: ${key}`);
    return;
  }

  const deleteParams = { 
    Bucket: bucketName, 
    Key: key 
  };

  try {
    logger.info(`deleteS3Object: Attempting to delete S3 object: ${key}`);
    await s3Client.send(new DeleteObjectCommand(deleteParams));
    logger.info(`deleteS3Object: S3 object ${key} deleted successfully.`);
  } catch (s3DeleteError) {
    logger.error(`deleteS3Object: Failed to delete S3 object ${key}`, { error: s3DeleteError });
    // Don't throw error - S3 deletion failure shouldn't break the main operation
  }
};

/**
 * Delete multiple S3 objects
 * @param {Array<string>} keys - Array of S3 object keys
 * @param {string} bucketName - S3 bucket name (optional)
 * @returns {Promise<void>}
 */
const deleteMultipleS3Objects = async (keys, bucketName = process.env.AWS_S3_BUCKET_NAME) => {
  const validKeys = keys.filter(key => key && key !== 'default.jpg');
  
  if (validKeys.length === 0) {
    logger.debug('deleteMultipleS3Objects: No valid keys to delete');
    return;
  }

  // Delete objects in parallel
  const deletePromises = validKeys.map(key => deleteS3Object(key, bucketName));
  await Promise.allSettled(deletePromises);
  
  logger.info(`deleteMultipleS3Objects: Attempted to delete ${validKeys.length} S3 objects`);
};

/**
 * Clean up S3 objects from an array of objects with key property
 * @param {Array<Object>} objects - Array of objects with 'key' property
 * @param {string} keyField - Field name containing the S3 key (default: 'key')
 * @param {string} bucketName - S3 bucket name (optional)
 * @returns {Promise<void>}
 */
const cleanupS3Objects = async (objects, keyField = 'key', bucketName = process.env.AWS_S3_BUCKET_NAME) => {
  if (!Array.isArray(objects) || objects.length === 0) {
    return;
  }

  const keys = objects
    .map(obj => obj[keyField])
    .filter(key => key && key !== 'default.jpg');

  await deleteMultipleS3Objects(keys, bucketName);
};

export {
  deleteS3Object,
  deleteMultipleS3Objects,
  cleanupS3Objects,
};