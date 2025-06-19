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
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router = express.Router();

// Multer setup for chat image uploads
const uploadDir = path.join(process.cwd(), 'uploads', 'chat');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.round(Math.random()*1e9)}${ext}`);
  }
});
const upload = multer({ storage });

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

router.post('/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const url = `/uploads/chat/${req.file.filename}`;
  res.status(201).json({ status: 'success', url });
});

export default router;
