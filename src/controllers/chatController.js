import mongoose from 'mongoose';
import ChatMessage from '../models/ChatMessage.js';
import Contract from '../models/Contract.js';
import AppError from '../utils/AppError.js';
import catchAsync from '../utils/catchAsync.js';

/**
 * Helper function to verify if the user is part of the contract.
 * @param {string} contractId - The ID of the contract.
 * @param {string} userId - The ID of the user.
 * @returns {object} - The contract object if the user is authorized.
 * @throws {AppError} - Throws an error if the contract ID is invalid, contract not found, or the user is not authorized.
 */
const verifyContractParty = async (contractId, userId) => {
    // Validate the contract ID format
    if (!mongoose.Types.ObjectId.isValid(contractId)) {
        throw new AppError('Invalid Contract ID format.', 400);
    }

    // Fetch the contract with only the provider and tasker IDs for authorization checks
    const contract = await Contract.findById(contractId).select('provider tasker');
    if (!contract) {
        throw new AppError('Contract not found.', 404);
    }

    // Extract provider and tasker IDs
    const providerIdStr = contract.provider?._id ? contract.provider._id.toString() : null;
    const taskerIdStr = contract.tasker?._id ? contract.tasker._id.toString() : null;

    // Check if the user is the provider or tasker for the contract
    const isProvider = providerIdStr === userId;
    const isTasker = taskerIdStr === userId;

    // If the user is not authorized, throw an error
    if (!isProvider && !isTasker) {
        throw new AppError('You are not authorized to access this conversation.', 403);
    }

    // Return the contract object if the user is authorized
    return contract;
};

/**
 * Controller to send a message for a specific contract.
 * @param {object} req - The request object.
 * @param {object} res - The response object.
 * @param {function} next - The next middleware function.
 */
export const sendMessage = catchAsync(async (req, res, next) => {
    const { contractId } = req.params;  // Extract contract ID from the route parameter
    const { message } = req.body;       // Extract the message content from the request body

    // Validate that the message is not empty
    if (!message || message.trim() === '') {
        return next(new AppError('Message content cannot be empty.', 400));
    }

    // Verify that the user is authorized to send a message for the given contract
    const contract = await verifyContractParty(contractId, req.user.id);

    // Determine the receiver ID (the other party in the contract)
    const receiverId = contract.provider._id.toString() === req.user.id
        ? contract.tasker._id   // If the user is the provider, send the message to the tasker
        : contract.provider._id; // Otherwise, send it to the provider

    // Create and save the new chat message
    const newMessage = await ChatMessage.create({
        contract: contractId,
        sender: req.user.id,
        receiver: receiverId,
        content: message.trim()  // Map the message to the 'content' field
    });

    // Fetch the populated message (to include sender details)
    const populatedMessage = await ChatMessage.findById(newMessage._id);

    // Respond with the newly created message
    res.status(201).json({
        status: 'success',
        data: { message: populatedMessage }
    });
});

/**
 * Controller to get the chat history for a contract.
 * @param {object} req - The request object.
 * @param {object} res - The response object.
 * @param {function} next - The next middleware function.
 */
export const getChatHistory = catchAsync(async (req, res, next) => {
    const { contractId } = req.params;  // Extract contract ID from the route parameter

    // Verify that the user is authorized to view the chat history
    await verifyContractParty(contractId, req.user.id);

    // Set pagination parameters (default to page 1 with 50 messages per page)
    const page = req.query.page * 1 || 1;
    const limit = req.query.limit * 1 || 50;
    const skip = (page - 1) * limit;

    // Fetch chat messages for the contract, sorted by timestamp (ascending)
    const messages = await ChatMessage.find({ contract: contractId })
        .sort({ timestamp: 1 })
        .skip(skip)
        .limit(limit);

    // Mark messages as read if the user is the receiver (update their read status)
    await ChatMessage.updateMany(
        { contract: contractId, receiver: req.user.id, readStatus: false },
        { $set: { readStatus: true } }
    );

    // Respond with the list of messages
    res.status(200).json({
        status: 'success',
        results: messages.length,
        data: { messages }
    });
});

/**
 * Controller to get a list of all conversations the user is involved in.
 * @param {object} req - The request object.
 * @param {object} res - The response object.
 * @param {function} next - The next middleware function.
 */
export const getConversations = catchAsync(async (req, res, next) => {
    const userId = req.user.id;  // Get the user ID from the request object

    // Find contracts where the user is either the provider or tasker
    const contracts = await Contract.find({ $or: [{ provider: userId }, { tasker: userId }] })
        .populate({ path: 'provider', select: 'firstName lastName profileImage' })
        .populate({ path: 'tasker', select: 'firstName lastName profileImage' })
        .populate('gig', 'title status')  // Populate gig details
        .sort({ updatedAt: -1 });  // Sort by last update (latest first)

    // Map contracts to conversations (show the other party and relevant contract details)
    const conversations = contracts.map(contract => {
        const otherParty = contract.provider._id.toString() !== userId
            ? contract.provider   // The other party is the provider
            : contract.tasker;    // The other party is the tasker

        return {
            contractId: contract._id,
            gigTitle: contract.gig?.title,        // Gig title
            gigStatus: contract.gig?.status,      // Gig status
            contractStatus: contract.status,      // Contract status
            otherParty: otherParty ? {           // Details of the other party
                id: otherParty._id,
                firstName: otherParty.firstName,
                lastName: otherParty.lastName,
                profileImage: otherParty.profileImage
            } : null,
            lastUpdatedAt: contract.updatedAt    // Last updated timestamp
        };
    });

    // Respond with the list of conversations
    res.status(200).json({
        status: 'success',
        results: conversations.length,
        data: { conversations }
    });
});
