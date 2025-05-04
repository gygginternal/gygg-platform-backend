import mongoose from 'mongoose';
import Contract from '../models/Contract.js';
import Payment from '../models/Payment.js'; // Needed for checking payment status on approval potentially
import User from '../models/User.js'; // Needed for role checks potentially
import AppError from '../utils/AppError.js';
import catchAsync from '../utils/catchAsync.js';

// --- Helper Function to Find and Authorize Contract Access ---
// Ensures the contract exists and the requesting user is either the provider or tasker
const findAndAuthorizeContract = async (contractId, userId, allowedRoles = ['provider', 'tasker', 'admin']) => {
    if (!mongoose.Types.ObjectId.isValid(contractId)) {
        throw new AppError('Invalid Contract ID format.', 400);
    }

    // Populate provider and tasker to check IDs
    const contract = await Contract.findById(contractId).populate('provider tasker');

    if (!contract) {
        throw new AppError('Contract not found.', 404);
    }

    const isProvider = contract.provider?._id.equals(userId);
    const isTasker = contract.tasker?._id.equals(userId);
    // Assuming req.user exists from 'protect' middleware
    const isAdmin = allowedRoles.includes('admin') // Check if admin role is allowed for this operation
                    && mongoose.Types.ObjectId.isValid(userId) // Ensure userId is valid before querying User model
                    && (await User.exists({ _id: userId, role: 'admin' })); // Check DB if user is admin

    if (!isProvider && !isTasker && !isAdmin) {
         throw new AppError('You are not authorized to access this contract.', 403);
    }

    // Return contract and flags indicating user's relation for easier use in controllers
    return { contract, isProvider, isTasker, isAdmin };
};


// --- Get Single Contract Details ---
export const getContract = catchAsync(async (req, res, next) => {
    const contractId = req.params.id || req.query.contractId; // Allow getting by param or query
    const userId = req.user.id;

    if (!contractId) {
         return next(new AppError('Contract ID is required.', 400));
    }

    // findAndAuthorizeContract handles validation and authorization
    const { contract } = await findAndAuthorizeContract(contractId, userId);

    // Optionally populate more details if needed for the response
    // await contract.populate('gig'); // Example

    res.status(200).json({
        status: 'success',
        data: {
            contract,
        },
    });
});


// --- Tasker Submits Work ---
export const submitWork = catchAsync(async (req, res, next) => {
    const contractId = req.params.id;
    const userId = req.user.id;

    // Find contract, ensuring user is the tasker
    const { contract, isTasker } = await findAndAuthorizeContract(contractId, userId, ['tasker']); // Only tasker allowed

    if (!isTasker) {
         return next(new AppError('Only the assigned tasker can submit work for this contract.', 403));
    }

    // Check current contract status (must be active)
    if (contract.status !== 'active') {
        return next(new AppError(`Cannot submit work. Contract status is '${contract.status}', requires 'active'.`, 400));
    }

    // Update status
    contract.status = 'submitted';
    // Add logic here to handle submitted files/proof if req.body contains them
    // e.g., contract.completionProof = req.body.proofLinks;
    await contract.save(); // Pre-save hook updates timestamp

    console.log(`Work submitted for Contract ${contract._id} by Tasker ${userId}`);
    // TODO: Notify Provider work has been submitted

    res.status(200).json({
        status: 'success',
        message: 'Work submitted successfully. Awaiting provider approval.',
        data: {
            contract,
        },
    });
});


// --- Provider Approves Completed Work ---
// This version updates the status AND initiates the payout trigger
// --- Provider Approves Completed Work (Corrected for Stripe Connect Model) ---
export const approveCompletionAndRelease = catchAsync(async (req, res, next) => {
    const contractId = req.params.id;
    const userId = req.user.id; // Provider approving

    // Find contract, ensuring user is the provider
    const { contract, isProvider } = await findAndAuthorizeContract(contractId, userId, ['provider']); // Only provider allowed

    if (!isProvider) {
         return next(new AppError('Only the provider can approve work for this contract.', 403));
    }

    // Check current contract status (must be submitted or maybe active if payment implies readiness)
    // Let's allow approval if it's 'submitted' or 'active' (since payment succeeded already)
    if (!['submitted', 'active'].includes(contract.status)) {
        return next(new AppError(`Cannot approve work at this stage. Contract status is '${contract.status}'.`, 400));
    }

    // Check associated payment status (MUST be 'succeeded' in the Connect model)
    const payment = await Payment.findOne({ contract: contractId });
    if (!payment || payment.status !== 'succeeded') {
        console.warn(`Attempting to approve Contract ${contractId} but associated Payment ${payment?._id} status is ${payment?.status} (Expected 'succeeded').`);
        return next(new AppError('Cannot approve work - payment not successfully completed or funds not transferred.', 400));
    }

    // --- Stripe Connect Model Logic ---
    // Funds are already in Tasker's Stripe balance. "Approving" here updates OUR contract status.
    console.log(`Connect Model: Approving Contract ${contractId}. Funds already in Tasker Stripe balance.`);

    contract.status = 'completed'; // Mark the contract as completed in our system
    await contract.save(); // Pre-save hook updates timestamp
    console.log(`Contract ${contract._id} marked as completed by Provider ${userId}.`);
    // TODO: Notify Tasker work approved (payout is handled by Stripe schedule)

    return res.status(200).json({
        status: 'success',
        message: 'Work approved successfully. Funds are available in the Tasker\'s Stripe balance per their payout schedule.',
        data: {
            contract,
        },
    });
});

// --- Provider Requests Revision (Example) ---
export const requestRevision = catchAsync(async (req, res, next) => {
    const contractId = req.params.id;
    const userId = req.user.id;
    const { reason } = req.body; // Get reason from request body

    if (!reason || reason.trim() === '') {
        return next(new AppError('A reason is required when requesting revisions.', 400));
    }

    // Find contract, ensuring user is the provider
    const { contract, isProvider } = await findAndAuthorizeContract(contractId, userId, ['provider']);

    if (!isProvider) {
         return next(new AppError('Only the provider can request revisions.', 403));
    }

    // Check current status (usually after 'submitted')
    if (contract.status !== 'submitted') {
        return next(new AppError(`Cannot request revision. Contract status is '${contract.status}', requires 'submitted'.`, 400));
    }

    // Update status back to 'active' (or a specific 'revision_requested' status)
    contract.status = 'active'; // Or 'revision_requested' if you add it to enum
    // Optionally store the reason
    // contract.revisionRequestReason = reason.trim();
    await contract.save();

    console.log(`Revision requested for Contract ${contract._id} by Provider ${userId}`);
    // TODO: Notify Tasker that revision is requested

    res.status(200).json({
        status: 'success',
        message: 'Revision requested successfully. Tasker has been notified.',
        data: {
            contract,
        },
    });
});


// --- Cancel Contract (Simplified Example) ---
// Real cancellation needs more logic (refunds, partial payments, state checks)
export const cancelContract = catchAsync(async (req, res, next) => {
     const contractId = req.params.id;
     const userId = req.user.id;
     const { reason } = req.body; // Optional reason

     const { contract, isProvider, isTasker } = await findAndAuthorizeContract(contractId, userId);

     // Define statuses where cancellation is allowed (e.g., not if completed or already cancelled)
     const cancellableStatuses = ['pending_payment', 'active', 'submitted', 'approved']; // Adjust as needed
     if (!cancellableStatuses.includes(contract.status)) {
         return next(new AppError(`Cannot cancel contract in its current status ('${contract.status}').`, 400));
     }

     // --- Add Refund/Reversal Logic Here if necessary ---
     // Check payment status. If 'succeeded' (Connect) or 'escrow_funded' (Platform),
     // you likely need to initiate a refund via paymentController.refundPaymentForContract
     // before marking the contract as cancelled.
     const payment = await Payment.findOne({ contract: contractId });
     if (payment && ['succeeded', 'escrow_funded'].includes(payment.status)) {
          console.warn(`Contract ${contractId} cancellation requested, but payment (${payment.status}) exists. REFUND PROCESS NEEDED.`);
          // !! For now, we just cancel the contract, but REFUND MUST BE HANDLED !!
          // return next(new AppError('Cannot cancel directly, payment exists. Please use refund process.', 400));
     }
     // --- End Refund Logic Placeholder ---


     contract.status = 'cancelled';
     if (reason) contract.cancellationReason = reason.trim();
     contract.cancelledAt = Date.now(); // Set timestamp explicitly or use hook
     await contract.save();

     console.log(`Contract ${contract._id} cancelled by User ${userId}`);
     // TODO: Notify other party

     res.status(200).json({
         status: 'success',
         message: 'Contract cancelled successfully.',
         data: {
             contract,
         },
     });
 });