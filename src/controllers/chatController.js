import mongoose from 'mongoose';
import ChatMessage from '../models/ChatMessage.js';
import Contract from '../models/Contract.js';
import AppError from '../utils/AppError.js';
import catchAsync from '../utils/catchAsync.js';

// --- Helper to verify user is part of the contract ---
// This helper now correctly extracts the ID string from potentially populated fields
const verifyContractParty = async (contractId, userId) => {
    // console.log(`--- verifyContractParty ENTERED ---`); // Keep for debugging if needed
    // console.log(`   Received contractId Param: ${contractId}`);
    // console.log(`   Received userId (from req.user.id): ${userId}`);

    if (!mongoose.Types.ObjectId.isValid(contractId)) {
         // console.error('   ERROR: Invalid Contract ID format.');
         throw new AppError('Invalid Contract ID format.', 400);
    }

    // Find the contract. Select provider/tasker explicitly to avoid issues if populate hooks change.
    const contract = await Contract.findById(contractId).select('provider tasker');

    if (!contract) {
        // console.error(`   ERROR: Contract not found for ID: ${contractId}`);
        throw new AppError('Contract not found.', 404);
    }

    // --- CORRECTED ID EXTRACTION ---
    // Access ._id before calling .toString() on potentially populated fields
    // Using optional chaining (?.) for safety
    const providerIdStr = contract.provider?._id ? contract.provider._id.toString() : null;
    const taskerIdStr = contract.tasker?._id ? contract.tasker._id.toString() : null;

    // console.log(`   Contract Provider ID from DB: ${providerIdStr}`); // Keep for debugging if needed
    // console.log(`   Contract Tasker ID from DB: ${taskerIdStr}`);

    // Perform the comparison checks
    const isProvider = providerIdStr === userId;
    const isTasker = taskerIdStr === userId;

    // console.log(`   Checking if User (${userId}) is Provider (${providerIdStr}): ${isProvider}`); // Keep for debugging if needed
    // console.log(`   Checking if User (${userId}) is Tasker (${taskerIdStr}): ${isTasker}`);

    // The actual authorization check
    if (!isProvider && !isTasker) {
        // console.error(`   AUTHORIZATION FAILED: User ${userId} is not Provider or Tasker for contract ${contractId}.`);
        throw new AppError('You are not authorized to access this conversation.', 403);
    }

    // console.log(`--- verifyContractParty PASSED for User ${userId} on Contract ${contractId} ---`); // Keep for debugging if needed
    // Return contract object containing the necessary IDs
    return contract;
};


// --- Send a Message ---
export const sendMessage = catchAsync(async (req, res, next) => {
    const { contractId } = req.params; // Get contractId from route parameter
    const { message } = req.body; // Expect 'message' field in request body
    const senderId = req.user.id;

    if (!message || message.trim() === '') {
        // Field name in error message should match the model's expectation for clarity
        return next(new AppError('Message content cannot be empty.', 400));
    }

    // 1. Verify user is part of the contract & get contract details
    const contract = await verifyContractParty(contractId, senderId);

    // 2. Determine the receiver ID (using ._id from the contract object)
    const receiverId = contract.provider._id.toString() === senderId
                            ? contract.tasker._id // Send to Tasker
                            : contract.provider._id; // Send to Provider

    // 3. Create and save the message, mapping 'message' to the 'content' field
    const newMessage = await ChatMessage.create({
        contract: contractId,
        sender: senderId,
        receiver: receiverId,
        content: message.trim(), // Map incoming 'message' to the 'content' field
    });

    // 4. Populate sender details for the response using the model's pre-find hook
    const populatedMessage = await ChatMessage.findById(newMessage._id);

    res.status(201).json({
        status: 'success',
        data: {
            message: populatedMessage, // Send the created message back
        },
    });
    // TODO: Implement real-time push notification (e.g., WebSockets) to the receiver here
});


// --- Get Chat History for a Contract ---
export const getChatHistory = catchAsync(async (req, res, next) => {
    const { contractId } = req.params;
    const userId = req.user.id;

    // 1. Verify user is part of the contract
    await verifyContractParty(contractId, userId);

    // 2. Fetch messages, sorted by timestamp (add pagination)
    const page = req.query.page * 1 || 1;
    const limit = req.query.limit * 1 || 50; // Load 50 messages per page
    const skip = (page - 1) * limit;

    const messages = await ChatMessage.find({ contract: contractId })
        .sort({ timestamp: 1 }) // Get oldest messages first for easier display ordering
        .skip(skip)
        .limit(limit);
        // Population is handled by the pre-find hook in the ChatMessage model

    // Optional: Mark messages as read where the current user is the receiver
    // Run this *after* fetching messages so the current fetch still shows unread status if needed frontend
    // Note: Consider potential race conditions if reads need to be instant/atomic with fetch
    await ChatMessage.updateMany(
        { contract: contractId, receiver: userId, readStatus: false },
        { $set: { readStatus: true } }
    );

    res.status(200).json({
        status: 'success',
        results: messages.length,
        data: {
            messages: messages, // Send in chronological order (oldest to newest)
        },
    });
});


// --- Get User's Conversations (List of Contracts) ---
export const getConversations = catchAsync(async (req, res, next) => {

    // <<< ADD THIS LOG >>>
    console.log('--- getConversations controller function ENTERED ---');
    // <<< END OF ADDED LOG >>>
 
    const userId = req.user.id; // This line would fail if protect didn't run and attach req.user

    // Find contracts where the user is either the provider or the tasker
    const contracts = await Contract.find({
        $or: [{ provider: userId }, { tasker: userId }],
        // Optionally filter by status
        // status: { $in: ['active', 'completed', 'pending_payment', 'submitted'] }
    })
    // Populate necessary details for display
    .populate({
        path: 'provider', // Populate provider info
        select: 'firstName lastName profileImage'
    })
    .populate({
        path: 'tasker', // Populate tasker info
        select: 'firstName lastName profileImage'
    })
    .populate('gig', 'title status') // Populate basic gig info
    .sort({ updatedAt: -1 }); // Sort by last update (e.g., last message or status change)


    // Structure the response nicely, showing the 'other' party
    const conversations = contracts.map(contract => {
        // Determine who the other party is based on the logged-in user ID
        const otherParty = contract.provider._id.toString() !== userId
                            ? contract.provider
                            : contract.tasker;
        return {
            contractId: contract._id,
            gigTitle: contract.gig?.title,
            gigStatus: contract.gig?.status,
            contractStatus: contract.status,
            otherParty: otherParty ? { // Check if otherParty exists (it should)
                id: otherParty._id,
                firstName: otherParty.firstName,
                lastName: otherParty.lastName,
                profileImage: otherParty.profileImage
            } : null,
            lastUpdatedAt: contract.updatedAt
            // TODO: Could add last message snippet and unread count here via aggregation later
        };
    });


    res.status(200).json({
        status: 'success',
        results: conversations.length,
        data: {
            conversations: conversations,
        },
    });
});