import mongoose from "mongoose";
import ChatMessage from "../models/ChatMessage.js";
import Contract from "../models/Contract.js";
import AppError from "../utils/AppError.js";
import catchAsync from "../utils/catchAsync.js";
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import Notification from '../models/Notification.js';
import logger from "../utils/logger.js";
import { 
  filterContent, 
  shouldBlockContent, 
  getViolationMessage,
  analyzeImageContent,
  getImageViolationMessage,
  shouldBlockImage
} from "../utils/contentFilter.js";

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

// AWS Rekognition client is now initialized in contentFilter.js

async function deleteS3Attachment(attachment) {
  if (!attachment || !attachment.url) return;
  const key = attachment.url.split('.amazonaws.com/')[1];
  if (key) {
    try {
      await s3Client.send(new DeleteObjectCommand({
        Bucket: process.env.AWS_S3_BUCKET_NAME,
        Key: key,
      }));
    } catch (err) {
      logger.error('Failed to delete S3 chat attachment', { key, err });
    }
  }
}



async function notifyAdmin(message, data) {
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
}

/**
 * Helper function to verify if the user is part of the contract.
 * @param {string} contractId - The ID of the contract.
 * @param {string} userId - The ID of the user.
 * @returns {object} - The contract object if the user is authorized.
 * @throws {AppError} - Throws an error if the contract ID is invalid, contract not found, or the user is not authorized.
 */
const verifyContractParty = async (contractId, userId) => {
  if (!contractId) return null; // Allow direct messaging without contract

  // Validate the contract ID format
  if (!mongoose.Types.ObjectId.isValid(contractId)) {
    throw new AppError("Invalid Contract ID format.", 400);
  }

  // Fetch the contract with only the provider and tasker IDs for authorization checks
  const contract = await Contract.findById(contractId).select(
    "provider tasker"
  );
  if (!contract) {
    throw new AppError("Contract not found.", 404);
  }

  // Extract provider and tasker IDs
  const providerIdStr = contract.provider?._id
    ? contract.provider._id.toString()
    : null;
  const taskerIdStr = contract.tasker?._id
    ? contract.tasker._id.toString()
    : null;

  // Check if the user is the provider or tasker for the contract
  const isProvider = providerIdStr === userId;
  const isTasker = taskerIdStr === userId;

  // If the user is not authorized, throw an error
  if (!isProvider && !isTasker) {
    throw new AppError(
      "You are not authorized to access this conversation.",
      403
    );
  }

  // Return the contract object if the user is authorized
  return contract;
};

/**
 * Controller to send a message.
 * Allows sending messages with or without a contract. If no contractId is provided, receiverId must be specified.
 * @param {object} req - The request object.
 * @param {object} res - The response object.
 * @param {function} next - The next middleware function.
 */
export const sendMessage = catchAsync(async (req, res, next) => {
  const { contractId } = req.params;
  const { message, type = 'text', attachment } = req.body;

  // Validate that the message is not empty
  if (!message || message.trim() === "") {
    return next(new AppError("Message content cannot be empty.", 400));
  }

  // Filter inappropriate content
  const contentCheck = filterContent(message);
  
  // Block message if it contains severe violations
  if (shouldBlockContent(message)) {
    const errorMessage = getViolationMessage(contentCheck.violations);
    logger.warn('Blocked inappropriate message', {
      userId: req.user.id,
      violations: contentCheck.violations,
      originalMessage: message.substring(0, 50) + '...'
    });
    return next(new AppError(errorMessage, 400));
  }

  // Use cleaned message if there were minor violations
  const finalMessage = contentCheck.isClean ? message.trim() : contentCheck.cleanedText;

  // Verify that the user is authorized to send a message for the given contract (if provided)
  const contract = await verifyContractParty(contractId, req.user.id);

  // Determine the receiver ID
  let receiverId;
  if (contract) {
    // If there's a contract, determine receiver based on contract parties
    receiverId =
    contract.provider._id.toString() === req.user.id
        ? contract.tasker._id
        : contract.provider._id;
  } else {
    // For direct messaging, receiver ID should be provided in the request
    receiverId = req.body.receiverId;
    if (!receiverId) {
      return next(new AppError("Receiver ID is required for direct messaging.", 400));
    }
  }

  // Create and save the new chat message
  const newMessage = await ChatMessage.create({
    contract: contractId || null,
    sender: req.user.id,
    receiver: receiverId,
    content: finalMessage,
    type,
    attachment: attachment || undefined
  });

  // Fetch the populated message (to include sender details)
  const populatedMessage = await ChatMessage.findById(newMessage._id);

  // Emit socket.io events for real-time updates
  if (chatWebsocket) {
    // Notify receiver of new message
    chatWebsocket.emitNewMessage(receiverId, populatedMessage);

    // Update unread count for receiver
    const unreadCount = await ChatMessage.countDocuments({
      receiver: receiverId,
      readStatus: false,
    });
    chatWebsocket.emitUnreadCountUpdate(receiverId, unreadCount);
  }

  // Create notification for new message
  await Notification.create({
    user: receiverId,
    type: 'new_message',
    message: `${req.user.firstName} sent you a message`,
    data: { contractId },
    icon: 'message.svg',
    link: '/messages',
  });

  // Respond with the newly created message
  res.status(201).json({
    status: "success",
    data: { message: populatedMessage },
  });
});

/**
 * Controller to get the chat history.
 * Allows fetching chat history by contractId or by userId (for direct messages).
 * @param {object} req - The request object.
 * @param {object} res - The response object.
 * @param {function} next - The next middleware function.
 */
export const getChatHistory = catchAsync(async (req, res, next) => {
  const { contractId } = req.params;
  const { userId } = req.query;

  // Verify that the user is authorized to view the chat history
  if (contractId) {
  await verifyContractParty(contractId, req.user.id);
  } else if (!userId) {
    return next(new AppError("Either contractId or userId is required.", 400));
  }

  // Set pagination parameters (default to page 1 with 50 messages per page)
  const page = req.query.page * 1 || 1;
  const limit = req.query.limit * 1 || 50;
  const skip = (page - 1) * limit;

  // Build query based on whether it's a contract chat or direct message
  const query = contractId
    ? { contract: contractId }
    : {
        $or: [
          { sender: req.user.id, receiver: userId },
          { sender: userId, receiver: req.user.id }
        ]
      };

  // Fetch chat messages, sorted by timestamp (ascending)
  const messages = await ChatMessage.find(query)
    .sort({ timestamp: 1 })
    .skip(skip)
    .limit(limit);

  // Mark messages as read if the user is the receiver
  const updateResult = await ChatMessage.updateMany(
    { receiver: req.user.id, readStatus: false },
    { $set: { readStatus: true } }
  );

  // If messages were marked as read, update unread count
  if (updateResult.modifiedCount > 0 && chatWebsocket) {
    const unreadCount = await ChatMessage.countDocuments({
      receiver: req.user.id,
      readStatus: false,
    });
    chatWebsocket.emitUnreadCountUpdate(req.user.id, unreadCount);
  }

  // Respond with the list of messages
  res.status(200).json({
    status: "success",
    results: messages.length,
    data: { messages },
  });
});

/**
 * Controller to get a list of all conversations the user is involved in.
 * @param {object} req - The request object.
 * @param {object} res - The response object.
 * @param {function} next - The next middleware function.
 */
export const getConversations = catchAsync(async (req, res, next) => {
  const userId = new mongoose.Types.ObjectId(req.user.id);

  // Get all unique users the current user has chatted with
  const conversations = await ChatMessage.aggregate([
    {
      $match: {
        $or: [
          { sender: userId },
          { receiver: userId }
        ]
      }
      },
    {
      $sort: { timestamp: -1 }
    },
    {
      $group: {
        _id: {
          $cond: [
            { $eq: ["$sender", userId] },
            "$receiver",
            "$sender"
          ]
        },
        lastMessage: { $first: "$$ROOT" },
        unreadCount: {
          $sum: {
            $cond: [
              { $and: [
                { $eq: ["$receiver", userId] },
                { $eq: ["$readStatus", false] }
              ]},
              1,
              0
            ]
          }
        }
      }
    },
    {
      $lookup: {
        from: "users",
        localField: "_id",
        foreignField: "_id",
        as: "otherParty"
      }
    },
    {
      $unwind: "$otherParty"
    },
    {
      $project: {
        _id: 1,
        otherParty: {
          _id: 1,
          firstName: 1,
          lastName: 1,
          profileImage: 1
        },
        lastMessage: {
          content: 1,
          timestamp: 1,
          type: 1,
          attachment: 1
        },
        unreadCount: 1
      }
    }
  ]);

  res.status(200).json({
    status: "success",
    results: conversations.length,
    data: { conversations }
  });
});

/**
 * Controller to get the count of unread messages for the logged-in user.
 * @param {object} req - The request object.
 * @param {object} res - The response object.
 * @param {function} next - The next middleware function.
 */
export const getUnreadMessageCount = catchAsync(async (req, res, next) => {
  const userId = req.user.id;

  // Find messages where the current user is the receiver and the message is unread
  const unreadCount = await ChatMessage.countDocuments({
    receiver: userId,
    readStatus: false,
  });

  res.status(200).json({
    status: "success",
    data: {
      unreadCount,
    },
  });
});

/**
 * Controller to upload chat images to S3 with content moderation
 * @param {object} req - The request object.
 * @param {object} res - The response object.
 * @param {function} next - The next middleware function.
 */
export const uploadChatImage = catchAsync(async (req, res, next) => {
  if (!req.file) {
    return next(new AppError("No image file provided.", 400));
  }

  // The S3 URL and key are available from multer-s3
  const imageUrl = req.file.location;
  const s3Key = req.file.key;
  const fileName = req.file.originalname;
  const fileType = req.file.mimetype;
  const fileSize = req.file.size;

  try {
    // Analyze image content for inappropriate material
    const moderationResult = await analyzeImageContent(s3Key);
    
    // If image contains inappropriate content, delete it and reject
    if (shouldBlockImage(moderationResult)) {
      // Delete the uploaded image from S3
      try {
        await s3Client.send(new DeleteObjectCommand({
          Bucket: process.env.AWS_S3_BUCKET_NAME,
          Key: s3Key,
        }));
      } catch (deleteError) {
        logger.error('Failed to delete inappropriate image from S3:', deleteError);
      }

      // Log the violation
      logger.warn('Blocked inappropriate image upload', {
        userId: req.user.id,
        fileName,
        labels: moderationResult.labels.map(l => l.Name),
        confidence: moderationResult.confidence
      });

      // Notify admin of the violation
      await notifyAdmin('Inappropriate image upload blocked', {
        userId: req.user.id,
        fileName,
        labels: moderationResult.labels,
        s3Key
      });

      const errorMessage = getImageViolationMessage(moderationResult.violations, 'shared');
      return next(new AppError(errorMessage, 400));
    }

    // Log successful upload with moderation check
    logger.info(`Chat image uploaded and approved: ${imageUrl}`, {
      userId: req.user.id,
      fileName,
      fileSize,
      moderationPassed: true,
      confidence: moderationResult.confidence
    });

    res.status(200).json({
      status: "success",
      data: {
        url: imageUrl,
        fileName,
        fileType,
        fileSize
      }
    });

  } catch (error) {
    // If moderation fails, delete the image and return error
    try {
      await s3Client.send(new DeleteObjectCommand({
        Bucket: process.env.AWS_S3_BUCKET_NAME,
        Key: s3Key,
      }));
    } catch (deleteError) {
      logger.error('Failed to delete image after moderation error:', deleteError);
    }

    logger.error('Image moderation failed:', error);
    return next(new AppError("Failed to process image. Please try again.", 500));
  }
});

export const deleteChatMessage = catchAsync(async (req, res, next) => {
  const message = await ChatMessage.findById(req.params.id);
  if (!message) return next(new AppError('No chat message found with that ID', 404));
  if (message.attachment && message.attachment.url) {
    await deleteS3Attachment(message.attachment);
  }
  await ChatMessage.findByIdAndDelete(message._id);
  logger.warn(`ChatMessage ${message._id} deleted by user ${req.user.id}`);
  await notifyAdmin('Chat message deleted', { messageId: message._id, sender: message.sender });
  res.status(204).json({ status: 'success', data: null });
});
