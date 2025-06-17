import express from 'express';
import { body, param, query } from 'express-validator';
import validateRequest from '../middleware/validateRequest.js';
import {
    sendMessage,         // Function to send a message in a chat
    getChatHistory,      // Function to get the chat history for a contract
    getConversations,    // Function to get all conversations for the logged-in user
    getUnreadMessageCount,
} from '../controllers/chatController.js';
import { protect } from "../controllers/authController.js";

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
router.post('/send/:contractId?', sendMessage);

export default router;
