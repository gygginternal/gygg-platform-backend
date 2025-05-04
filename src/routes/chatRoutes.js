import express from 'express';
import { body, param, query } from 'express-validator';
import validateRequest from '../middleware/validateRequest.js';
import {
    sendMessage,         // Function to send a message in a chat
    getChatHistory,      // Function to get the chat history for a contract
    getConversations,    // Function to get all conversations for the logged-in user
} from '../controllers/chatController.js';
import { protect } from '../controllers/authController.js';  // Middleware to protect routes that require authentication

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

// Route to get all conversations for the logged-in user (accessible only by logged-in users)
router.get('/conversations', getConversations); // Get all conversations


/**
 * --- Contract-Specific Message Routes ---
 * These routes allow users to send and view messages for a specific contract.
 * Permissions for these actions are handled by the 'protect' middleware, ensuring only authenticated users can send or view messages.
 */

// Route to send a message or get the chat history for a specific contract.
// The 'contractId' parameter specifies which contract's messages should be retrieved or sent to.
router.route('/contracts/:contractId/messages')
    .post([ // Validate sending a message
        param('contractId').isMongoId().withMessage('Invalid Contract ID format'),
        body('message').notEmpty().withMessage('Message content cannot be empty').trim().escape().isLength({ max: 2000 }), // Ensure message exists and is reasonable length
    ], validateRequest, sendMessage) // Validate the request before sending the message
    .get([ // Validate getting chat history
        param('contractId').isMongoId().withMessage('Invalid Contract ID format'),
        query('page').optional().isInt({ min: 1 }).toInt(),
        query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    ], validateRequest, getChatHistory); // Validate the request before retrieving chat history

export default router;
