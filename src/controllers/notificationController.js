import Notification from '../models/Notification.js';
import catchAsync from '../utils/catchAsync.js';
import AppError from '../utils/AppError.js';
import logger from '../utils/logger.js';
import notifyAdmin from '../utils/notifyAdmin.js';

// Get all notifications for the logged-in user
export const getNotifications = catchAsync(async (req, res, next) => {
  // Parse pagination parameters
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const skip = (page - 1) * limit;
  
  // Get notifications for the user
  const notifications = await Notification.find({ user: req.user.id })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);
  
  // Get total count for pagination
  const total = await Notification.countDocuments({ user: req.user.id });
  const unreadCount = await Notification.countDocuments({ user: req.user.id, isRead: false });
  
  // Calculate pagination info
  const hasMore = skip + notifications.length < total;
  
  res.status(200).json({ 
    status: 'success', 
    data: { 
      notifications,
      pagination: {
        page,
        limit,
        total,
        hasMore
      },
      unreadCount
    } 
  });
});

// Get a specific notification by ID
export const getNotification = catchAsync(async (req, res, next) => {
  const notification = await Notification.findOne({ 
    _id: req.params.id, 
    user: req.user.id 
  });
  
  if (!notification) {
    return next(new AppError('Notification not found', 404));
  }
  
  res.status(200).json({ status: 'success', data: { notification } });
});

// Mark a notification as read
export const markAsRead = catchAsync(async (req, res, next) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, user: req.user.id },
    { isRead: true },
    { new: true }
  );
  if (!notification) return next(new AppError('Notification not found', 404));
  res.status(200).json({ status: 'success', data: { notification } });
});

// Delete a notification
export const deleteNotification = catchAsync(async (req, res, next) => {
  const notification = await Notification.findOneAndDelete({ _id: req.params.id, user: req.user.id });
  if (!notification) return next(new AppError('Notification not found', 404));
  logger.warn(`Notification ${notification._id} deleted by user ${req.user.id}`);
  await notifyAdmin('Notification deleted', { notificationId: notification._id, deletedBy: req.user.id });
  res.status(204).json({ status: 'success', data: null });
}); 