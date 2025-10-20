import express from 'express';
import { body, param, query } from 'express-validator';
import validateRequest from '../middleware/validateRequest.js';
import {
  sendMessage,
  getChatHistory,
  getConversations,
  markAsRead,
  addReaction,
  deleteMessage,
  editMessage,
  getUnreadMessageCount,
  searchMessages
} from '../controllers/modernChatController.js';
import { protect } from "../controllers/authController.js";
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router = express.Router();

// Multer setup for chat attachments
const uploadDir = path.join(process.cwd(), 'uploads', 'chat');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const filename = `${Date.now()}-${Math.round(Math.random()*1e9)}${ext}`;
    cb(null, filename);
  }
});

const upload = multer({ 
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit per file
    files: 1, // Only allow 1 file per request
    fieldSize: 5 * 1024 * 1024, // 5MB for other form fields combined
    parts: 20, // Maximum number of parts (fields + files)
    fields: 10 // Maximum number of non-file fields
  },
  fileFilter: (req, file, cb) => {
    // Allow images, videos, audio, and documents
    const allowedTypes = /jpeg|jpg|png|gif|webp|mp4|mov|avi|mp3|wav|pdf|doc|docx|txt/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});

// Protect all routes
router.use(protect);

// Conversation routes
router.get('/conversations', 
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 50 }),
    query('search').optional().isLength({ min: 1, max: 100 }),
    query('type').optional().isIn(['all', 'direct', 'group', 'contract'])
  ],
  validateRequest,
  getConversations
);

// Message routes
router.post('/send',
  [
    body('receiverId').notEmpty().isMongoId(),
    body('content').optional().isLength({ min: 1, max: 4000 }),
    body('type').optional().isIn(['text', 'image', 'file', 'voice', 'video', 'location', 'emoji', 'gif']),
    body('priority').optional().isIn(['low', 'normal', 'high', 'urgent']),
    body('replyTo').optional().isMongoId(),
    body('location.latitude').optional().isFloat({ min: -90, max: 90 }),
    body('location.longitude').optional().isFloat({ min: -180, max: 180 })
  ],
  validateRequest,
  sendMessage
);

router.get('/history',
  [
    query('conversationId').optional().isMongoId(),
    query('userId').optional().isMongoId(),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 })
  ],
  validateRequest,
  getChatHistory
);

router.patch('/mark-read/:conversationId',
  [
    param('conversationId').isMongoId()
  ],
  validateRequest,
  markAsRead
);

// Message interaction routes
router.post('/messages/:messageId/react',
  [
    param('messageId').isMongoId(),
    body('emoji').notEmpty().isLength({ min: 1, max: 10 })
  ],
  validateRequest,
  addReaction
);

router.delete('/messages/:messageId',
  [
    param('messageId').isMongoId()
  ],
  validateRequest,
  deleteMessage
);

router.patch('/messages/:messageId',
  [
    param('messageId').isMongoId(),
    body('content').notEmpty().isLength({ min: 1, max: 4000 })
  ],
  validateRequest,
  editMessage
);

// Utility routes
router.get('/unread-count', getUnreadMessageCount);

router.get('/search',
  [
    query('query').notEmpty().isLength({ min: 1, max: 100 }),
    query('conversationId').optional().isMongoId(),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 50 })
  ],
  validateRequest,
  searchMessages
);

// File upload routes
router.post('/upload/image', upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ 
      status: 'error', 
      message: 'No file uploaded' 
    });
  }
  
  const url = `/uploads/chat/${req.file.filename}`;
  res.status(201).json({ 
    status: 'success', 
    data: {
      url,
      fileName: req.file.originalname,
      fileType: req.file.mimetype,
      fileSize: req.file.size
    }
  });
});

router.post('/upload/file', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ 
      status: 'error', 
      message: 'No file uploaded' 
    });
  }
  
  const url = `/uploads/chat/${req.file.filename}`;
  res.status(201).json({ 
    status: 'success', 
    data: {
      url,
      fileName: req.file.originalname,
      fileType: req.file.mimetype,
      fileSize: req.file.size
    }
  });
});

router.post('/upload/voice', upload.single('voice'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ 
      status: 'error', 
      message: 'No file uploaded' 
    });
  }
  
  const url = `/uploads/chat/${req.file.filename}`;
  res.status(201).json({ 
    status: 'success', 
    data: {
      url,
      fileName: req.file.originalname,
      fileType: req.file.mimetype,
      fileSize: req.file.size,
      duration: req.body.duration || null
    }
  });
});

export default router;