import { validationResult } from 'express-validator';
import AppError from '../utils/AppError.js';
import logger from '../utils/logger.js'; // Optional: Log validation errors

const validateRequest = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        // Log the validation errors at debug level
        logger.debug('Validation errors occurred', {
            errors: errors.array(),
            url: req.originalUrl,
            method: req.method,
            ip: req.ip
         });

        const errorMessages = errors.array().map(err => `${err.path}: ${err.msg}`).join('. ');
        // Use AppError for consistent operational errors
        return next(new AppError(`Invalid input data. ${errorMessages}`, 400));
    }
    next();
};

export default validateRequest;