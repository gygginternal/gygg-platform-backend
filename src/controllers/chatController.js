import mongoose from "mongoose";
import ChatMessage from "../models/ChatMessage.js";
import Contract from "../models/Contract.js";
import AppError from "../utils/AppError.js";
import catchAsync from "../utils/catchAsync.js";

let chatWebsocket;

export const setChatWebsocket = (websocket) => {
  chatWebsocket = websocket;
};

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
    content: message.trim(),
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

  // Respond with the newly created message
  res.status(201).json({
    status: "success",
    data: { message: populatedMessage },
  });
});

/**
 * Controller to get the chat history.
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
