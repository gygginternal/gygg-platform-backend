// src/routes/chatRoutes.js
import express from 'express';
import {
    sendMessage,
    getChatHistory,
    getConversations
} from '../controllers/chatController.js';
import { protect } from '../controllers/authController.js'; // Ensure protect is imported

const router = express.Router();

// --- ADD LOGGING HERE ---
console.log('Chat router configuration starting...'); // Log when this file loads

// Apply protect middleware to ALL subsequent routes defined on this router
router.use((req, res, next) => {
    console.log(`>>> Chat Route Hit: ${req.method} ${req.originalUrl} - Applying protect middleware...`); // Log BEFORE protect runs
    next(); // Pass control to the next middleware in the stack (which should be protect)
}, protect); // Apply protect middleware


console.log('Protect middleware applied to chat router.');

// Route definitions AFTER router.use(protect)
router.get('/conversations', getConversations);

router
    .route('/contracts/:contractId/messages')
    .post(sendMessage)
    .get(getChatHistory);

console.log('Chat router configuration finished.');

export default router;