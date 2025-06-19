import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  type: {
    type: String,
    required: true,
    enum: [
      'new_comment',
      'new_like',
      'new_post',
      'new_gig',
      'gig_application',
      'gig_accepted',
      'gig_completed',
      'new_message',
      'review_received',
      'payment',
      'system',
    ],
  },
  message: {
    type: String,
    required: true,
  },
  data: {
    type: Object,
    default: {},
  },
  isRead: {
    type: Boolean,
    default: false,
  },
}, { timestamps: { createdAt: true, updatedAt: false } });

const Notification = mongoose.model('Notification', notificationSchema);
export default Notification; 