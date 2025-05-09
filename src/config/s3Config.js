import { S3Client } from '@aws-sdk/client-s3';
import multer from 'multer';
import multerS3 from 'multer-s3';
import path from 'path'; // Built-in Node.js module
import crypto from 'crypto'; // For generating unique names
import AppError from '../utils/AppError.js'; // Adjust path if needed
import logger from '../utils/logger.js'; // Adjust path if needed
import dotenv from 'dotenv';

dotenv.config({ path: './.env' }); // Ensure env vars are loaded

// --- Input Validation ---
if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY || !process.env.AWS_REGION || !process.env.AWS_S3_BUCKET_NAME) {
     logger.error("FATAL ERROR: Missing required AWS S3 environment variables.");
     process.exit(1);
}


// --- Configure AWS S3 Client (SDK v3) ---
const s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
});
logger.info(`AWS S3 Client configured for region: ${process.env.AWS_REGION}`);


// --- Configure Multer-S3 Storage Engine ---
const s3Storage = multerS3({
    s3: s3Client, // Use the configured S3 client
    bucket: process.env.AWS_S3_BUCKET_NAME, // Bucket name from env
    // acl: 'public-read', // Optional: Set ACL - 'public-read' makes files publicly accessible via URL.
                           // Omit this (default is private) if using CloudFront or pre-signed URLs.
                           // Requires bucket NOT to block all public access if used.
    metadata: function (req, file, cb) {
        // Add metadata if needed (e.g., original filename)
        cb(null, { fieldName: file.fieldname, originalName: file.originalname });
    },
    key: function (req, file, cb) {
        // Generate a unique key (filename) for the S3 object
        const userId = req.user?.id || 'anonymous'; // Get user ID if available
        let folder = 'other-uploads'; // Default folder

        // Determine folder based on fieldname or route context
        if (file.fieldname === 'profileImage') {
            folder = `users/${userId}/profile`;
        } else if (file.fieldname === 'albumImage') {
            folder = `users/${userId}/album`;
        } // Add more folders for gig proof, etc.

        const randomBytes = crypto.randomBytes(16).toString('hex');
        const extension = path.extname(file.originalname); // Get file extension
        const filename = `${folder}/${Date.now()}-${randomBytes}${extension}`;
        logger.debug(`Uploading to S3 key: ${filename}`);
        cb(null, filename);
    }
});

// --- Multer Upload Middleware ---
const uploadS3 = multer({
    storage: s3Storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10 MB limit (match frontend if possible)
    },
    fileFilter: (req, file, cb) => {
        // Accept only image files (adjust mimetypes as needed)
        const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true); // Accept file
        } else {
            logger.warn(`Rejected file upload due to invalid mimetype: ${file.mimetype}`, { userId: req.user?.id });
            cb(new AppError('Invalid file type. Only JPG, PNG, GIF, WEBP images allowed.', 400), false); // Reject file
        }
    }
});

// Export S3 client (for direct operations like delete) and upload middleware
export { s3Client, uploadS3 };