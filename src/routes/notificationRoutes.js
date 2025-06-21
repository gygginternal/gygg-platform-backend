import express from 'express';
import { getNotifications, getNotification, markAsRead, deleteNotification } from '../controllers/notificationController.js';
import { protect } from '../controllers/authController.js';

const router = express.Router();

router.use(protect);

router.get('/', getNotifications);
router.get('/:id', getNotification);
router.patch('/:id/read', markAsRead);
router.delete('/:id', deleteNotification);

export default router; 