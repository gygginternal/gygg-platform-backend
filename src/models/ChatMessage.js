import mongoose from 'mongoose';

const chatMessageSchema = new mongoose.Schema({
  contract: {
    type: mongoose.Schema.ObjectId,
    ref: 'Contract',
    required: [true, 'A message must belong to a contract.']
  },
  sender: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: [true, 'A message must have a sender.']
  },
  receiver: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: [true, 'A message must have a receiver.']
  },
  content: {
    type: String,
    required: [true, 'Message content cannot be empty.'],
    trim: true
  },
  readStatus: {
    type: Boolean,
    default: false
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: { createdAt: 'timestamp', updatedAt: false }
});

// Indexes
chatMessageSchema.index({ contract: 1, timestamp: -1 });
chatMessageSchema.index({ receiver: 1, readStatus: 1 });

// Auto-populate sender details
chatMessageSchema.pre(/^find/, function(next) {
  this.populate({
    path: 'sender',
    select: 'firstName lastName profileImage'
  });
  next();
});

const ChatMessage = mongoose.model('ChatMessage', chatMessageSchema);

export default ChatMessage;
