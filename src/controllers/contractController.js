import mongoose from "mongoose";
import { Gig } from "../models/Gig.js";
import Contract from "../models/Contract.js";
import Payment from "../models/Payment.js";
import User from "../models/User.js";
import AppError from "../utils/AppError.js";
import catchAsync from "../utils/catchAsync.js";
import logger from "../utils/logger.js";
import Application from "../models/Application.js";
import { Offer } from "../models/Offer.js";
import Notification from '../models/Notification.js';
import Review from '../models/Review.js';
import notifyAdmin from '../utils/notifyAdmin.js';
import { stripe } from "./paymentController.js";

export const getMyContracts = catchAsync(async (req, res, next) => {
  const userId = req.user._id; // Get the logged-in user's ID

  // Pagination parameters
  const page = parseInt(req.query.page, 10) || 1; // Default to page 1
  const limit = parseInt(req.query.limit, 10) || 10; // Default to 10 results per page
  const skip = (page - 1) * limit;

  // Filters
  const { name, status, category, minCost, maxCost } = req.query;

  // Build the query object
  const query = {
    $or: [{ provider: userId }, { tasker: userId }],
  };

  // Add filters for gig name
  if (name) {
    query["gig.title"] = { $regex: name, $options: "i" }; // Case-insensitive search
  }

  // Add filters for status (accepts an array or a single value)
  if (status) {
    const statusArray = Array.isArray(status) ? status : [status];
    query["status"] = { $in: statusArray };
  }

  // Add filter for gig category
  if (category && category !== "All") {
    query["gig.category"] = category;
  }

  // Add filter for price range (agreedCost)
  if (minCost || maxCost) {
    query["agreedCost"] = {};
    if (minCost) query["agreedCost"].$gte = parseFloat(minCost);
    if (maxCost) query["agreedCost"].$lte = parseFloat(maxCost);
  }

  // Fetch contracts where the user is either the provider or the tasker
  const contracts = await Contract.find(query)
    .populate("gig", "title category cost status") // Populate gig details
    .populate("provider", "firstName lastName email") // Populate provider details
    .populate("tasker", "firstName lastName email") // Populate tasker details
    .skip(skip)
    .limit(limit);

  // Get the total count of contracts for the user with the applied filters
  const totalContracts = await Contract.countDocuments(query);

  // Format the response
  const formattedContracts = contracts.map((contract) => ({
    id: contract._id,
    gigTitle: contract.gig?.title,
    gigId: contract.gig?._id,
    gigCategory: contract.gig?.category,
    gigCost: contract.gig?.cost,
    gigStatus: contract.gig?.status,
    provider: [contract.provider?.firstName, contract.provider?.lastName].join(
      " "
    ),
    tasker: [contract.tasker?.firstName, contract.tasker?.lastName].join(" "),
    status: contract.status,
    createdAt: contract.createdAt,
    updatedAt: contract.updatedAt,
  }));

  res.status(200).json({
    status: "success",
    results: formattedContracts.length,
    total: totalContracts,
    currentPage: page,
    totalPages: Math.ceil(totalContracts / limit),
    data: {
      contracts: formattedContracts,
    },
  });
});

/**
 * Helper function to verify if the user is part of the contract.
 * @param {string} contractId - The ID of the contract.
 * @param {string} userId - The ID of the requesting user.
 * @param {Array<string>} allowedRoles - List of roles allowed to access the contract (default: ['provider', 'tasker', 'admin']).
 * @returns {Promise<{contract: object, isProvider: boolean, isTasker: boolean, isAdmin: boolean}>}
 * @throws {AppError} - If contract ID is invalid, contract is not found, or the user is not authorized.
 */
const findAndAuthorizeContract = async (
  contractId,
  userId,
  allowedRoles = ["provider", "tasker", "admin"]
) => {
  if (!mongoose.Types.ObjectId.isValid(contractId)) {
    throw new AppError("Invalid Contract ID format.", 400);
  }

  const contract = await Contract.findById(contractId).populate(
    "provider tasker"
  );

  if (!contract) {
    throw new AppError("Contract not found.", 404);
  }

  const isProvider = contract.provider?._id.equals(userId);
  const isTasker = contract.tasker?._id.equals(userId);
  const isAdmin =
    allowedRoles.includes("admin") &&
    mongoose.Types.ObjectId.isValid(userId) &&
    (await User.exists({ _id: userId, role: "admin" }));

  if (!isProvider && !isTasker && !isAdmin) {
    throw new AppError("You are not authorized to access this contract.", 403);
  }

  return { contract, isProvider, isTasker, isAdmin };
};

/**
 * Get a single contract by ID.
 * @route GET /contracts/:id
 * @access Provider | Tasker | Admin
 */
export const getContract = catchAsync(async (req, res, next) => {
  const paramId = req.params.id; // For /contracts/:id
  const queryGigId = req.query.gigId; // For /contracts?gigId=...
  const userId = req.user.id;

  let contractInstance; // The Mongoose document
  let paymentInstance; // The Mongoose document

  if (paramId) {
    logger.debug(`getContract: Attempting to find by paramId: ${paramId}`);
    if (!mongoose.Types.ObjectId.isValid(paramId)) {
      return next(
        new AppError("Invalid Contract ID format in URL parameter.", 400)
      );
    }
    contractInstance = await Contract.findById(paramId);
    if (!contractInstance) {
      return next(new AppError("Contract not found by ID.", 404));
    }
  } else if (queryGigId) {
    logger.debug(
      `getContract: Attempting to find by queryGigId: ${queryGigId}`
    );
    if (!mongoose.Types.ObjectId.isValid(queryGigId)) {
      return next(new AppError("Invalid Gig ID format in query.", 400));
    }
    contractInstance = await Contract.findOne({ gig: queryGigId });
    paymentInstance = await Payment.findOne({ gig: queryGigId });
    if (!contractInstance) {
      logger.info(
        `No contract found for gigId: ${queryGigId}, returning null contract.`
      );
      // This is a valid scenario, frontend expects null if no contract
      return res
        .status(200)
        .json({ status: "success", data: { contract: null } });
    }
  } else {
    return next(
      new AppError("Contract ID parameter or Gig ID query is required.", 400)
    );
  }

  // Now, authorize access to the found contractInstance
  // findAndAuthorizeContract expects the actual contract._id as string for its internal ObjectId check
  const { contract: authorizedContract } = await findAndAuthorizeContract(
    contractInstance._id.toString(),
    userId
  );

  res.status(200).json({
    status: "success",
    data: {
      contract: authorizedContract, // Send the authorized (and populated) contract
      payment: paymentInstance,
    },
  });
});

/**
 * Tasker submits work for an active contract.
 * @route PATCH /contracts/:id/submit
 * @access Tasker only
 */
export const submitWork = catchAsync(async (req, res, next) => {
  const contractId = req.params.id;
  const userId = req.user.id;

  const { contract, isTasker } = await findAndAuthorizeContract(
    contractId,
    userId,
    ["tasker"]
  );

  if (!isTasker) {
    return next(
      new AppError(
        "Only the assigned tasker can submit work for this contract.",
        403
      )
    );
  }

  if (contract.status !== "active") {
    return next(
      new AppError(
        `Cannot submit work. Contract status is '${contract.status}', requires 'active'.`,
        400
      )
    );
  }

  contract.status = "submitted";
  await contract.save();

  console.log(
    `Work submitted for Contract ${contract._id} by Tasker ${userId}`
  );

  res.status(200).json({
    status: "success",
    message: "Work submitted successfully. Awaiting provider approval.",
    data: {
      contract,
    },
  });
});

/**
 * Provider approves submitted work, marking contract as completed.
 * @route PATCH /contracts/:id/approve
 * @access Provider only
 */
export const approveCompletionAndRelease = catchAsync(
  async (req, res, next) => {
    const contractId = req.params.id;
    const userId = req.user.id;

    const { contract, isProvider } = await findAndAuthorizeContract(
      contractId,
      userId,
      ["provider"]
    );

    if (!isProvider) {
      return next(
        new AppError(
          "Only the provider can approve work for this contract.",
          403
        )
      );
    }

    if (!["submitted", "active"].includes(contract.status)) {
      return next(
        new AppError(
          `Cannot approve work at this stage. Contract status is '${contract.status}'.`,
          400
        )
      );
    }

    const payment = await Payment.findOne({ contract: contractId });

    if (!payment || payment.status !== "succeeded") {
      console.warn(
        `Payment issue for Contract ${contractId}: ${payment?.status}`
      );
      return next(
        new AppError(
          "Cannot approve work - payment not successfully completed or funds not transferred.",
          400
        )
      );
    }

    // --- Manual payout to tasker (Stripe Express, manual schedule) ---
    // Funds are in the tasker's Stripe balance, but not yet in their bank account.
    // This triggers the payout to their bank when work is approved.
    try {
      await stripe.payouts.create(
        {
          amount: payment.amountReceivedByPayee, // in cents
          currency: payment.currency,
        },
        {
          stripeAccount: contract.tasker.stripeAccountId,
        }
      );
    } catch (err) {
      console.error("Error triggering manual payout to tasker:", err);
      return next(new AppError("Failed to release payout to tasker.", 500));
    }

    contract.status = "completed";
    await contract.save();

    console.log(
      `Contract ${contract._id} marked as completed by Provider ${userId}. Payout released to tasker.`
    );

    // Notify tasker
    await sendNotification({
      user: contract.tasker,
      type: 'contract_accepted',
      message: `Your contract has been accepted!`,
      data: { contractId: contract._id, gigId: contract.gig },
      icon: 'contract.svg',
      link: '/contracts',
    });

    // Notify tasker of payment received
    await sendNotification({
      user: contract.tasker,
      type: 'payment_received',
      message: `Payment received for contract!`,
      data: { contractId: contract._id, gigId: contract.gig },
      icon: 'money.svg',
      link: '/contracts',
    });

    return res.status(200).json({
      status: "success",
      message:
        "Work approved successfully. Payout released to the Tasker's bank account.",
      data: {
        contract,
      },
    });
  }
);

/**
 * Provider requests revision on submitted work.
 * @route PATCH /contracts/:id/revision
 * @access Provider only
 */
export const requestRevision = catchAsync(async (req, res, next) => {
  const contractId = req.params.id;
  const userId = req.user.id;
  const { reason } = req.body;

  if (!reason || reason.trim() === "") {
    return next(
      new AppError("A reason is required when requesting revisions.", 400)
    );
  }

  const { contract, isProvider } = await findAndAuthorizeContract(
    contractId,
    userId,
    ["provider"]
  );

  if (!isProvider) {
    return next(new AppError("Only the provider can request revisions.", 403));
  }

  if (contract.status !== "submitted") {
    return next(
      new AppError(
        `Cannot request revision. Contract status is '${contract.status}', requires 'submitted'.`,
        400
      )
    );
  }

  contract.status = "active";
  await contract.save();

  console.log(
    `Revision requested for Contract ${contract._id} by Provider ${userId}`
  );

  res.status(200).json({
    status: "success",
    message: "Revision requested successfully. Tasker has been notified.",
    data: {
      contract,
    },
  });
});

/**
 * Cancels a contract if it's in a cancellable state.
 * @route PATCH /contracts/:id/cancel
 * @access Provider | Tasker
 */
export const cancelContract = catchAsync(async (req, res, next) => {
  const contractId = req.params.id;
  const userId = req.user.id;
  const { reason } = req.body;

  const { contract, isProvider, isTasker } = await findAndAuthorizeContract(
    contractId,
    userId
  );

  const cancellableStatuses = [
    "pending_payment",
    "active",
    "submitted",
    "approved",
  ];

  if (!cancellableStatuses.includes(contract.status)) {
    return next(
      new AppError(
        `Cannot cancel contract in its current status ('${contract.status}').`,
        400
      )
    );
  }

  const payment = await Payment.findOne({ contract: contractId });

  if (payment && ["succeeded", "escrow_funded"].includes(payment.status)) {
    console.warn(
      `Contract ${contractId} has a payment with status ${payment.status}. Consider refund.`
    );
    // Optionally: return next(new AppError('Cannot cancel directly, payment exists. Use refund process.', 400));
  }

  // Delete all related offers for the gig associated with the contract
  const gigId = contract.gig;
  await Offer.deleteMany({ gig: gigId });

  contract.status = "cancelled";
  if (reason) contract.cancellationReason = reason.trim();
  contract.cancelledAt = Date.now();
  await contract.save();

  console.log(`Contract ${contract._id} cancelled by User ${userId}`);
  console.log(`All related offers for gig ${gigId} have been deleted.`);

  res.status(200).json({
    status: "success",
    message: "Contract cancelled successfully. All related offers deleted.",
    data: {
      contract,
    },
  });
});

function getUserId(val) {
  if (!val) return undefined;
  if (typeof val === 'string') return val;
  if (val._id) return val._id.toString();
  if (val.id) return val.id.toString();
  return val.toString();
}

export const deleteContract = catchAsync(async (req, res, next) => {
  const contractId = req.params.id;
  const contract = await Contract.findById(contractId);
  if (!contract) return next(new AppError('No contract found with that ID', 404));

  // Extract user IDs safely
  const providerId = getUserId(contract.provider);
  const taskerId = getUserId(contract.tasker);
  const userId = req.user.id.toString();

  // Debug: log user and contract IDs
  console.log('[DEBUG] deleteContract:', {
    userId,
    providerId,
    taskerId,
    userRole: req.user.role
  });

  // Business rule: Once a tasker is assigned, only admins can delete the contract
  if (taskerId && !req.user.role.includes('admin')) {
    return next(new AppError('Cannot delete contract once a tasker has been assigned. Only administrators can delete assigned contracts.', 403));
  }

  // Only provider, tasker (if no tasker assigned), or admin can delete
  if ([providerId, taskerId].indexOf(userId) === -1 && !req.user.role.includes('admin')) {
    return next(new AppError('You do not have permission to delete this contract.', 403));
  }

  // Cascade delete related records
  await Promise.all([
    Payment.deleteMany({ contract: contractId }),
    Review.deleteMany({ contract: contractId }),
    Notification.deleteMany({ 'data.contractId': contractId }),
    Offer.deleteMany({ application: contractId }),
  ]);
  await Contract.findByIdAndDelete(contractId);
  logger.warn(`Contract ${contractId} and related data deleted by user ${req.user.id}`);
  await notifyAdmin('Contract deleted', { contractId, deletedBy: req.user.id });
  res.status(204).json({ status: 'success', data: null });
});

// Helper to send notification
async function sendNotification({ user, type, message, data, icon, link }) {
  try {
    await Notification.create({ user, type, message, data, icon, link });
  } catch (err) {
    console.error('Failed to send notification', { user, type, message, data, icon, link, err });
  }
}

export const getMyContractsWithPayments = catchAsync(async (req, res, next) => {
  const userId = req.user._id;

  // Find all contracts for this user
  const contracts = await Contract.find({
    $or: [{ provider: userId }, { tasker: userId }],
  })
    .populate("gig", "title category cost status")
    .populate("provider", "firstName lastName email")
    .populate("tasker", "firstName lastName email");

  // For each contract, find the associated payment (if any)
  const results = await Promise.all(
    contracts.map(async contract => {
      const payment = await Payment.findOne({ contract: contract._id });
      return {
        contract,
        payment,
      };
    })
  );

  res.status(200).json({
    status: "success",
    results: results.length,
    data: results,
  });
});
