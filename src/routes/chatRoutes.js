import express from 'express';
/**
 * @swagger
 * tags:
 *   name: Chat
 *   description: Chat and messaging endpoints
 */

import { body, param, query } from 'express-validator';
import validateRequest from '../middleware/validateRequest.js';
import {
    sendMessage,         // Function to send a message in a chat
    getChatHistory,      // Function to get the chat history for a contract
    getConversations,    // Function to get all conversations for the logged-in user
    getUnreadMessageCount,
    uploadChatImage,     // Function to upload chat images
} from '../controllers/chatController.js';
import { protect } from "../controllers/authController.js";
import { uploadS3 } from '../config/s3Config.js';

const router = express.Router();

/**
 * --- Protect Routes ---
 * All routes below this middleware require the user to be logged in.
 */
router.use(protect); // Protect all routes below this middleware (user must be logged in)


/**
 * --- Chat Routes ---
 * These routes handle the retrieval of conversations and sending/receiving messages.
 */

/**
 * @swagger
 * /chat/conversations:
 *   get:
 *     summary: Get all conversations for the logged-in user
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Conversations retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: success
 *                 data:
 *                   type: object
 *                   properties:
 *                     conversations:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/ChatMessage'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
// Route to get all conversations for the logged-in user (accessible only by logged-in users)
router.get('/conversations', getConversations); // Get all conversations

// Route to get the count of unread messages for the logged-in user
router.get('/unread-count', getUnreadMessageCount);


/**
 * --- Contract-Specific Message Routes ---
 * These routes allow users to send and view messages for a specific contract.
 * Permissions for these actions are handled by the 'protect' middleware, ensuring only authenticated users can send or view messages.
 */

// Route to get chat history for a specific contract or user
router.get('/history/:contractId?', getChatHistory);

// Route to send a message (with or without a contract)
router.post('/send/:contractId?', 
  [
    body('message').optional().trim(),
    body('receiverId').optional().isMongoId().withMessage('Invalid receiver ID'),
    body('type').optional().isIn(['text', 'image', 'file']).withMessage('Invalid message type'),
  ],
  validateRequest,
  sendMessage
);

// Route to upload chat images to S3
router.post('/upload-image', 
  uploadS3.single('chatImage'),
  uploadChatImage
);

export default router;
