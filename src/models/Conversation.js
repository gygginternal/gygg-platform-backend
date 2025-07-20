import mongoose from "mongoose";

// Define schema for chat conversations
const conversationSchema = new mongoose.Schema(
  {
    // Participants in the conversation
    participants: [{
      type: mongoose.Schema.ObjectId,
      ref: "User",
      required: true,
    }],

    // Type of conversation
    type: {
      type: String,
      enum: ['direct', 'group', 'contract'],
      default: 'direct'
    },

    // For group conversations
    name: {
      type: String,
      trim: true,
      maxlength: [100, 'Conversation name cannot exceed 100 characters'],
    },

    description: {
      type: String,
      trim: true,
      maxlength: [500, 'Description cannot exceed 500 characters'],
    },

    avatar: String,

    // Admin users (for group chats)
    admins: [{
      type: mongoose.Schema.ObjectId,
      ref: "User",
    }],

    // Last message in the conversation
    lastMessage: {
      type: mongoose.Schema.ObjectId,
      ref: "ChatMessage"
    },

    // Last activity timestamp
    lastActivity: {
      type: Date,
      default: Date.now,
      index: true,
    },

    // Conversation settings
    settings: {
      // Mute notifications
      mutedBy: [{
        user: {
          type: mongoose.Schema.ObjectId,
          ref: "User"
        },
        mutedUntil: Date
      }],

      // Message retention
      messageRetention: {
        type: Number,
        default: 0 // 0 = forever, number = days
      },

      // Auto-delete messages
      autoDelete: {
        enabled: {
          type: Boolean,
          default: false
        },
        duration: {
          type: Number,
          default: 24 // hours
        }
      }
    },

    // Contract reference (for contract-based conversations)
    contract: {
      type: mongoose.Schema.ObjectId,
      ref: "Contract"
    },

    // Conversation status
    status: {
      type: String,
      enum: ['active', 'archived', 'deleted'],
      default: 'active',
      index: true,
    },

    // Pinned status for participants
    pinnedBy: [{
      type: mongoose.Schema.ObjectId,
      ref: "User"
    }],

    // Archived status for participants
    archivedBy: [{
      user: {
        type: mongoose.Schema.ObjectId,
        ref: "User"
      },
      archivedAt: {
        type: Date,
        default: Date.now
      }
    }],

    // Blocked participants
    blockedBy: [{
      blocker: {
        type: mongoose.Schema.ObjectId,
        ref: "User"
      },
      blocked: {
        type: mongoose.Schema.ObjectId,
        ref: "User"
      },
      blockedAt: {
        type: Date,
        default: Date.now
      }
    }],

    // Message count
    messageCount: {
      type: Number,
      default: 0
    },

    // Created by
    createdBy: {
      type: mongoose.Schema.ObjectId,
      ref: "User",
      required: true,
    }
  },
  {
    timestamps: true,
  }
);

// Indexes for better performance
conversationSchema.index({ participants: 1, lastActivity: -1 });
conversationSchema.index({ type: 1, status: 1 });
conversationSchema.index({ contract: 1 });

// Pre-find middleware to populate participants
conversationSchema.pre(/^find/, function (next) {
  this.populate({
    path: "participants",
    select: "firstName lastName profileImage isOnline lastSeen",
  }).populate({
    path: "lastMessage",
    select: "content type timestamp sender attachment",
    populate: {
      path: "sender",
      select: "firstName lastName"
    }
  });
  next();
});

// Static method to find or create a direct conversation
conversationSchema.statics.findOrCreateDirect = async function(user1Id, user2Id) {
  const participants = [user1Id, user2Id].sort();
  
  let conversation = await this.findOne({
    type: 'direct',
    participants: { $all: participants, $size: 2 }
  });

  if (!conversation) {
    conversation = await this.create({
      participants,
      type: 'direct',
      createdBy: user1Id
    });
  }

  return conversation;
};

// Instance method to add participant
conversationSchema.methods.addParticipant = function(userId) {
  if (!this.participants.includes(userId)) {
    this.participants.push(userId);
    return this.save();
  }
  return Promise.resolve(this);
};

// Instance method to remove participant
conversationSchema.methods.removeParticipant = function(userId) {
  this.participants = this.participants.filter(p => p.toString() !== userId.toString());
  return this.save();
};

// Instance method to check if user is participant
conversationSchema.methods.hasParticipant = function(userId) {
  return this.participants.some(p => p._id ? p._id.toString() === userId.toString() : p.toString() === userId.toString());
};

// Instance method to get unread count for a user
conversationSchema.methods.getUnreadCount = async function(userId) {
  const ChatMessage = mongoose.model('ChatMessage');
  return await ChatMessage.countDocuments({
    conversation: this._id,
    sender: { $ne: userId },
    status: { $ne: 'read' },
    isDeleted: false
  });
};

export const Conversation = mongoose.model("Conversation", conversationSchema);
export default Conversation;