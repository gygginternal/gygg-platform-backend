import mongoose from "mongoose";
import ChatMessage from "../models/ChatMessage.js";
import Conversation from "../models/Conversation.js";
import Contract from "../models/Contract.js";
import AppError from "../utils/AppError.js";
import catchAsync from "../utils/catchAsync.js";
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import Notification from '../models/Notification.js';
import logger from "../utils/logger.js";

let chatWebsocket;

export const setChatWebsocket = (websocket) => {
  chatWebsocket = websocket;
};

const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

/**
 * Modern controller to send a message with enhanced features
 */
export const sendMessage = catchAsync(async (req, res, next) => {
  const { 
    receiverId, 
    content, 
    type = 'text', 
    attachment, 
    replyTo, 
    priority = 'normal',
    location 
  } = req.body;

  // Validate message content based on type
  if (type === 'text' && (!content || content.trim() === "")) {
    return next(new AppError("Message content cannot be empty.", 400));
  }

  if (!receiverId) {
    return next(new AppError("Receiver ID is required.", 400));
  }

  // Find or create conversation
  const conversation = await Conversation.findOrCreateDirect(req.user.id, receiverId);

  // Verify user is participant in conversation
  if (!conversation.hasParticipant(req.user.id)) {
    return next(new AppError("You are not authorized to send messages in this conversation.", 403));
  }

  // Create the message
  const messageData = {
    conversation: conversation._id,
    sender: req.user.id,
    receiver: receiverId,
    content: content?.trim(),
    type,
    priority,
    status: 'sent'
  };

  // Add optional fields
  if (attachment) messageData.attachment = attachment;
  if (replyTo) messageData.replyTo = replyTo;
  if (location) messageData.location = location;

  const newMessage = await ChatMessage.create(messageData);

  // Update conversation's last message and activity
  conversation.lastMessage = newMessage._id;
  conversation.lastActivity = new Date();
  conversation.messageCount += 1;
  await conversation.save();

  // Populate the message for response
  const populatedMessage = await ChatMessage.findById(newMessage._id)
    .populate('sender', 'firstName lastName profileImage')
    .populate('replyTo', 'content sender type');

  // Real-time updates
  if (chatWebsocket) {
    // Emit to conversation room
    chatWebsocket.emitToConversation(conversation._id, 'chat:newMessage', populatedMessage);
    
    // Emit to specific participants
    conversation.participants.forEach(participantId => {
      if (participantId.toString() !== req.user.id) {
        chatWebsocket.emitNewMessage(participantId, populatedMessage);
      }
    });

    // Update unread counts
    const unreadCount = await conversation.getUnreadCount(receiverId);
    chatWebsocket.emitUnreadCountUpdate(receiverId, unreadCount);
  }

  // Create notification
  await Notification.create({
    user: receiverId,
    type: 'new_message',
    message: `${req.user.firstName} sent you a message`,
    data: { conversationId: conversation._id },
    icon: 'message.svg',
    link: `/chat/${conversation._id}`,
  });

  res.status(201).json({
    status: "success",
    data: { 
      message: populatedMessage,
      conversation: conversation._id
    },
  });
});

/**
 * Modern controller to get chat history with enhanced features
 */
export const getChatHistory = catchAsync(async (req, res, next) => {
  const { conversationId, userId } = req.query;
  
  let conversation;
  
  if (conversationId) {
    // Get conversation by ID
    conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return next(new AppError("Conversation not found.", 404));
    }
  } else if (userId) {
    // Find or create direct conversation
    conversation = await Conversation.findOrCreateDirect(req.user.id, userId);
  } else {
    return next(new AppError("Either conversationId or userId is required.", 400));
  }

  // Verify user is participant
  if (!conversation.hasParticipant(req.user.id)) {
    return next(new AppError("You are not authorized to view this conversation.", 403));
  }

  // Pagination
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const skip = (page - 1) * limit;

  // Fetch messages with enhanced population
  const messages = await ChatMessage.find({
    conversation: conversation._id,
    isDeleted: false
  })
    .populate('sender', 'firstName lastName profileImage')
    .populate('replyTo', 'content sender type attachment')
    .populate({
      path: 'reactions.user',
      select: 'firstName lastName'
    })
    .sort({ timestamp: -1 })
    .skip(skip)
    .limit(limit);

  // Mark messages as read
  await ChatMessage.updateMany(
    {
      conversation: conversation._id,
      sender: { $ne: req.user.id },
      status: { $ne: 'read' }
    },
    { 
      $set: { status: 'read' },
      $push: {
        readBy: {
          user: req.user.id,
          readAt: new Date()
        }
      }
    }
  );

  // Update unread count via websocket
  if (chatWebsocket) {
    const unreadCount = await conversation.getUnreadCount(req.user.id);
    chatWebsocket.emitUnreadCountUpdate(req.user.id, unreadCount);
  }

  res.status(200).json({
    status: "success",
    results: messages.length,
    data: { 
      messages: messages.reverse(), // Return in chronological order
      conversation: {
        id: conversation._id,
        type: conversation.type,
        participants: conversation.participants,
        name: conversation.name
      }
    },
  });
});

/**
 * Modern controller to get conversations with enhanced features
 */
export const getConversations = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const { page = 1, limit = 20, search, type = 'all' } = req.query;

  // Build query
  const query = {
    participants: userId,
    status: 'active'
  };

  // Filter by conversation type
  if (type !== 'all') {
    query.type = type;
  }

  // Get conversations with pagination
  const conversations = await Conversation.find(query)
    .populate({
      path: 'participants',
      select: 'firstName lastName profileImage isOnline lastSeen',
      match: { _id: { $ne: userId } } // Exclude current user
    })
    .populate({
      path: 'lastMessage',
      select: 'content type timestamp sender attachment status',
      populate: {
        path: 'sender',
        select: 'firstName lastName'
      }
    })
    .sort({ lastActivity: -1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit));

  // Get unread counts for each conversation
  const conversationsWithUnread = await Promise.all(
    conversations.map(async (conv) => {
      const unreadCount = await conv.getUnreadCount(userId);
      return {
        id: conv._id,
        type: conv.type,
        name: conv.name,
        participants: conv.participants,
        lastMessage: conv.lastMessage,
        lastActivity: conv.lastActivity,
        unreadCount,
        isPinned: conv.pinnedBy.includes(userId),
        isArchived: conv.archivedBy.some(a => a.user.toString() === userId),
        messageCount: conv.messageCount
      };
    })
  );

  res.status(200).json({
    status: "success",
    results: conversationsWithUnread.length,
    data: { conversations: conversationsWithUnread }
  });
});

/**
 * Mark conversation as read
 */
export const markAsRead = catchAsync(async (req, res, next) => {
  const { conversationId } = req.params;
  
  const conversation = await Conversation.findById(conversationId);
  if (!conversation) {
    return next(new AppError("Conversation not found.", 404));
  }

  if (!conversation.hasParticipant(req.user.id)) {
    return next(new AppError("You are not authorized to access this conversation.", 403));
  }

  // Mark all unread messages as read
  await ChatMessage.updateMany(
    {
      conversation: conversationId,
      sender: { $ne: req.user.id },
      status: { $ne: 'read' }
    },
    { 
      $set: { status: 'read' },
      $push: {
        readBy: {
          user: req.user.id,
          readAt: new Date()
        }
      }
    }
  );

  // Update unread count via websocket
  if (chatWebsocket) {
    chatWebsocket.emitUnreadCountUpdate(req.user.id, 0);
  }

  res.status(200).json({
    status: "success",
    message: "Messages marked as read"
  });
});

/**
 * Add reaction to message
 */
export const addReaction = catchAsync(async (req, res, next) => {
  const { messageId } = req.params;
  const { emoji } = req.body;

  if (!emoji) {
    return next(new AppError("Emoji is required.", 400));
  }

  const message = await ChatMessage.findById(messageId);
  if (!message) {
    return next(new AppError("Message not found.", 404));
  }

  // Check if user already reacted with this emoji
  const existingReaction = message.reactions.find(
    r => r.user.toString() === req.user.id && r.emoji === emoji
  );

  if (existingReaction) {
    // Remove reaction
    message.reactions = message.reactions.filter(
      r => !(r.user.toString() === req.user.id && r.emoji === emoji)
    );
  } else {
    // Add reaction
    message.reactions.push({
      user: req.user.id,
      emoji
    });
  }

  await message.save();

  // Emit real-time update
  if (chatWebsocket) {
    const conversation = await Conversation.findById(message.conversation);
    conversation.participants.forEach(participantId => {
      chatWebsocket.emitMessageUpdate(participantId, message);
    });
  }

  res.status(200).json({
    status: "success",
    data: { message }
  });
});

/**
 * Delete message
 */
export const deleteMessage = catchAsync(async (req, res, next) => {
  const { messageId } = req.params;

  const message = await ChatMessage.findById(messageId);
  if (!message) {
    return next(new AppError("Message not found.", 404));
  }

  // Only sender can delete their message
  if (message.sender.toString() !== req.user.id) {
    return next(new AppError("You can only delete your own messages.", 403));
  }

  // Soft delete
  message.isDeleted = true;
  message.deletedAt = new Date();
  await message.save();

  // Emit real-time update
  if (chatWebsocket) {
    const conversation = await Conversation.findById(message.conversation);
    conversation.participants.forEach(participantId => {
      chatWebsocket.emitMessageUpdate(participantId, message);
    });
  }

  res.status(200).json({
    status: "success",
    message: "Message deleted successfully"
  });
});

/**
 * Edit message
 */
export const editMessage = catchAsync(async (req, res, next) => {
  const { messageId } = req.params;
  const { content } = req.body;

  if (!content || content.trim() === "") {
    return next(new AppError("Message content cannot be empty.", 400));
  }

  const message = await ChatMessage.findById(messageId);
  if (!message) {
    return next(new AppError("Message not found.", 404));
  }

  // Only sender can edit their message
  if (message.sender.toString() !== req.user.id) {
    return next(new AppError("You can only edit your own messages.", 403));
  }

  // Add to edit history
  message.editHistory.push({
    content: message.content
  });

  // Update content
  message.content = content.trim();
  await message.save();

  // Emit real-time update
  if (chatWebsocket) {
    const conversation = await Conversation.findById(message.conversation);
    conversation.participants.forEach(participantId => {
      chatWebsocket.emitMessageUpdate(participantId, message);
    });
  }

  res.status(200).json({
    status: "success",
    data: { message }
  });
});

/**
 * Get unread message count
 */
export const getUnreadMessageCount = catchAsync(async (req, res, next) => {
  const userId = req.user.id;

  const unreadCount = await ChatMessage.countDocuments({
    receiver: userId,
    status: { $ne: 'read' },
    isDeleted: false
  });

  res.status(200).json({
    status: "success",
    data: { unreadCount }
  });
});

/**
 * Search messages
 */
export const searchMessages = catchAsync(async (req, res, next) => {
  const { query, conversationId, page = 1, limit = 20 } = req.query;

  if (!query) {
    return next(new AppError("Search query is required.", 400));
  }

  const searchQuery = {
    $text: { $search: query },
    isDeleted: false
  };

  // If conversationId provided, search within that conversation
  if (conversationId) {
    const conversation = await Conversation.findById(conversationId);
    if (!conversation || !conversation.hasParticipant(req.user.id)) {
      return next(new AppError("Conversation not found or unauthorized.", 404));
    }
    searchQuery.conversation = conversationId;
  } else {
    // Search in all user's conversations
    const userConversations = await Conversation.find({
      participants: req.user.id
    }).select('_id');
    
    searchQuery.conversation = { 
      $in: userConversations.map(c => c._id) 
    };
  }

  const messages = await ChatMessage.find(searchQuery)
    .populate('sender', 'firstName lastName profileImage')
    .populate('conversation', 'type name participants')
    .sort({ score: { $meta: 'textScore' }, timestamp: -1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit));

  res.status(200).json({
    status: "success",
    results: messages.length,
    data: { messages }
  });
});