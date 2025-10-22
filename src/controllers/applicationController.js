// src/controllers/applicationController.js
import Application from "../models/Application.js";
import { Gig } from "../models/Gig.js";
import Contract from "../models/Contract.js";
import catchAsync from "../utils/catchAsync.js";
import AppError from "../utils/AppError.js";
import app from "../app.js";
import User from "../models/User.js"; // Import the User model
import Notification from '../models/Notification.js';
import logger from '../utils/logger.js';
import notifyAdmin from '../utils/notifyAdmin.js';
import { getChatWebsocket } from "./chatController.js";

// --- Accept Application (Create Contract) ---
export const acceptApplication = catchAsync(async (req, res, next) => {
  const { applicationId } = req.params;

  // Find the application by ID and populate required fields
  const application = await Application.findById(applicationId)
    .populate("gig") // Populate the gig details
    .populate("user"); // Populate the tasker details

  // Check if the application exists
  if (!application) {
    logger.error(`acceptApplication: Application ${applicationId} not found`);
    return next(new AppError("Application not found.", 404));
  }

  // Check if the logged-in user is the provider who posted the gig
  // Handle both populated and unpopulated cases for gig.postedBy
  const gigProviderId = application.gig.postedBy._id ? 
    application.gig.postedBy._id.toString() : 
    application.gig.postedBy.toString();
    
  if (gigProviderId !== req.user._id.toString()) {
    return next(
      new AppError(
        "You are not authorized to accept this application.",
        403
      )
    );
  }

  // Check if the application is already accepted
  if (application.status === "accepted") {
    logger.warn(`acceptApplication: Application ${applicationId} already accepted`);
    return next(
      new AppError("This application has already been accepted.", 400)
    );
  }

  // Check if the gig is already assigned
  const gig = application.gig;
  if (gig.status === "assigned") {
    return next(new AppError("This gig has already been assigned.", 400));
  }

  // Update the application status to "accepted"
  application.status = "accepted";
  await application.save();

  // Update the gig status to "assigned"
  gig.status = "assigned";
  gig.assignedTo = application.user; // Assign the tasker to the gig
  await gig.save();
  logger.info(`acceptApplication: Gig ${gig._id} assigned to tasker ${application.user}`);

  // Create a new contract
  const contractData = {
    gig: gig._id,
    provider: gig.postedBy._id || gig.postedBy, // Handle both populated and unpopulated cases
    tasker: application.user, // The tasker assigned to the gig
    status: "active", // Set to active when contract is created
    isHourly: gig.isHourly || false,
  };

  // Set contract fields based on gig type
  if (gig.isHourly) {
    contractData.hourlyRate = gig.ratePerHour;
    contractData.estimatedHours = gig.estimatedHours || gig.duration || 1;
    // For hourly contracts, agreedCost is calculated as rate * estimated hours
    contractData.agreedCost = gig.ratePerHour * (gig.estimatedHours || gig.duration || 1);
    logger.info(`acceptApplication: Creating hourly contract - Rate: ${gig.ratePerHour}, Hours: ${contractData.estimatedHours}, Total: ${contractData.agreedCost}`);
  } else {
    contractData.agreedCost = gig.cost;
    logger.info(`acceptApplication: Creating fixed contract - Cost: ${gig.cost}`);
  }

  logger.debug(`acceptApplication: Contract data:`, contractData);
  const contract = await Contract.create(contractData);
  logger.info(`acceptApplication: Contract ${contract._id} created successfully`);

  // Emit WebSocket events to notify connected clients
  const chatWebsocket = getChatWebsocket();
  if (chatWebsocket) {
    try {
      // Emit to provider (gig poster)
      chatWebsocket.emitNewMessage(gig.postedBy._id || gig.postedBy, {
        type: 'contract_created',
        content: `A new contract has been created for your gig: ${gig.title}`,
        gigId: gig._id,
        contractId: contract._id,
        taskerId: application.user._id,
        timestamp: new Date().toISOString()
      });

      // Emit to tasker (gig applicant)
      chatWebsocket.emitNewMessage(application.user._id, {
        type: 'contract_accepted',
        content: `Your application for gig '${gig.title}' has been accepted! A new contract has been created.`,
        gigId: gig._id,
        contractId: contract._id,
        providerId: gig.postedBy._id || gig.postedBy,
        timestamp: new Date().toISOString()
      });

      logger.info(`[WS] Contract creation events emitted for gig ${gig._id} and contract ${contract._id}`);
    } catch (websocketError) {
      logger.error('[WS] Error emitting contract creation events:', websocketError.message);
    }
  }

  res.status(200).json({
    status: "success",
    message: "Application accepted and contract created successfully.",
    data: {
      application,
      gig,
      contract,
    },
  });
});// Add missing functions to applicationController.js

// --- Accept Application (Create Contract) ---
// --- Reject Application ---
export const rejectApplication = catchAsync(async (req, res, next) => {
  const { applicationId } = req.params;

  // Find the application by ID
  const application = await Application.findById(applicationId)
    .populate("gig")
    .populate("user");

  // Check if the application exists
  if (!application) {
    logger.error(`rejectApplication: Application ${applicationId} not found`);
    return next(new AppError("Application not found.", 404));
  }

  // Check if the logged-in user is the provider who posted the gig
  const gigProviderId = application.gig.postedBy._id ? 
    application.gig.postedBy._id.toString() : 
    application.gig.postedBy.toString();
    
  if (gigProviderId !== req.user._id.toString()) {
    return next(
      new AppError(
        "You are not authorized to reject this application.",
        403
      )
    );
  }

  // Check if the application is already rejected or accepted
  if (application.status !== "pending") {
    logger.warn(`rejectApplication: Application ${applicationId} already processed`);
    return next(
      new AppError(`This application has already been ${application.status}.`, 400)
    );
  }

  // Update the application status to "rejected"
  application.status = "rejected";
  await application.save();

  logger.info(`rejectApplication: Application ${applicationId} rejected successfully`);

  res.status(200).json({
    status: "success",
    message: "Application rejected successfully.",
    data: {
      application,
    },
  });
});

// --- Cancel Application ---
export const cancelApplication = catchAsync(async (req, res, next) => {
  const { applicationId } = req.params;

  // Find the application by ID
  const application = await Application.findById(applicationId)
    .populate("gig")
    .populate("user");

  // Check if the application exists
  if (!application) {
    logger.error(`cancelApplication: Application ${applicationId} not found`);
    return next(new AppError("Application not found.", 404));
  }

  // Check if the logged-in user is the tasker who applied
  if (application.user._id.toString() !== req.user._id.toString()) {
    return next(
      new AppError(
        "You are not authorized to cancel this application.",
        403
      )
    );
  }

  // Check if the application can be cancelled
  if (!["pending", "accepted"].includes(application.status)) {
    logger.warn(`cancelApplication: Application ${applicationId} cannot be cancelled (status: ${application.status})`);
    return next(
      new AppError(`This application cannot be cancelled (status: ${application.status}).`, 400)
    );
  }

  // Update the application status to "cancelled"
  application.status = "cancelled";
  await application.save();

  logger.info(`cancelApplication: Application ${applicationId} cancelled successfully`);

  res.status(200).json({
    status: "success",
    message: "Application cancelled successfully.",
    data: {
      application,
    },
  });
});

// --- Get Top Match Applications ---
export const topMatchApplications = catchAsync(async (req, res, next) => {
  const user = req.user;
  const { limit = 10 } = req.query;

  // Find all applications where the user is the provider (gig poster)
  const userGigs = await Gig.find({ postedBy: user._id }).select('_id');
  const gigIds = userGigs.map(gig => gig._id);

  if (gigIds.length === 0) {
    return res.status(200).json({
      status: "success",
      data: {
        applications: [],
        message: "No gigs found to match applications against"
      },
    });
  }

  // Find all applications for user's gigs, excluding accepted ones (which have formed contracts)
  const applications = await Application.find({
    gig: { $in: gigIds },
    status: { $ne: 'accepted' }  // Exclude accepted applications (contracts already formed)
  })
    .populate({
      path: 'user',
      select: 'firstName lastName profileImage skills hobbies'
    })
    .populate({
      path: 'gig',
      select: 'title category cost location deadline duration'
    })
    .sort({ createdAt: -1 })
    .limit(parseInt(limit));

  res.status(200).json({
    status: "success",
    data: {
      applications,
    },
  });
});

// --- Get My Applied Gigs ---
export const getMyAppliedGigs = catchAsync(async (req, res, next) => {
  const user = req.user;
  const { status = 'all', page = 1, limit = 10 } = req.query;

  // Build query filter
  let query = { user: user._id };
  
  if (status !== 'all') {
    query.status = status;
  } else {
    // By default, exclude 'accepted' applications since they become contracts
    // Only show applications that are still in application status
    query.status = { $ne: 'accepted' };
  }

  // Get applications with pagination
  const applications = await Application.find(query)
    .populate({
      path: 'gig',
      select: 'title description category cost location deadline duration status'
    })
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit));

  // Get total count
  const totalApplications = await Application.countDocuments(query);
  const totalPages = Math.ceil(totalApplications / limit);

  res.status(200).json({
    status: "success",
    data: {
      applications,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalItems: totalApplications,
        itemsPerPage: parseInt(limit)
      }
    },
  });
});