import Notification from '../models/Notification.js';
import logger from './logger.js';

const notifyAdmin = async (message, data) => {
  try {
    await Notification.create({
      user: process.env.ADMIN_USER_ID,
      type: 'system',
      message,
      data,
    });
  } catch (err) {
    logger.error('Failed to notify admin', { message, data, err });
  }
};

export default notifyAdmin; 