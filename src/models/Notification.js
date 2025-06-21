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
      'contract_accepted',
      'payment_received',
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
  icon: {
    type: String,
    required: false,
  },
  link: {
    type: String,
    required: false,
  },
}, { timestamps: { createdAt: true, updatedAt: false } });

const Notification = mongoose.model('Notification', notificationSchema);
export default Notification; 