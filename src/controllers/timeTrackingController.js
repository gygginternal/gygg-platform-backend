import TimeEntry from "../models/TimeEntry.js";
import Contract from "../models/Contract.js";
import { Gig } from "../models/Gig.js";
import User from "../models/User.js";
import AppError from "../utils/AppError.js";
import catchAsync from "../utils/catchAsync.js";
import logger from "../utils/logger.js";
import mongoose from "mongoose";

// Start a new time tracking session
export const startTimeTracking = catchAsync(async (req, res, next) => {
  const { contractId } = req.params;
  const { description } = req.body;
  const taskerId = req.user.id;

  // Validate contract ID
  if (!mongoose.Types.ObjectId.isValid(contractId)) {
    return next(new AppError("Invalid contract ID format.", 400));
  }

  // Find and validate contract
  const contract = await Contract.findById(contractId).populate('gig');
  if (!contract) {
    return next(new AppError("Contract not found.", 404));
  }

  // Check if user is the assigned tasker
  if (contract.tasker.toString() !== taskerId) {
    return next(new AppError("You are not authorized to track time for this contract.", 403));
  }

  // Check if contract is active
  if (contract.status !== "active") {
    return next(new AppError("Cannot track time for inactive contract.", 400));
  }

  // Check if gig is hourly
  if (!contract.isHourly) {
    return next(new AppError("Time tracking is only available for hourly contracts.", 400));
  }

  // Check if there's already an active session
  const activeSession = await TimeEntry.findOne({
    tasker: taskerId,
    contract: contractId,
    status: "active"
  });

  if (activeSession) {
    return next(new AppError("You already have an active time tracking session for this contract.", 400));
  }

  // Create new time entry
  const timeEntry = await TimeEntry.create({
    contract: contractId,
    gig: contract.gig._id,
    tasker: taskerId,
    provider: contract.provider,
    startTime: new Date(),
    description: description?.trim() || "",
    hourlyRate: contract.hourlyRate,
    status: "active"
  });

  logger.info(`Time tracking started for contract ${contractId} by tasker ${taskerId}`);

  res.status(201).json({
    status: "success",
    message: "Time tracking started successfully",
    data: { timeEntry }
  });
});

// Stop current time tracking session
export const stopTimeTracking = catchAsync(async (req, res, next) => {
  const { contractId } = req.params;
  const { description } = req.body;
  const taskerId = req.user.id;

  // Find active session
  const activeSession = await TimeEntry.findOne({
    tasker: taskerId,
    contract: contractId,
    status: "active"
  });

  if (!activeSession) {
    return next(new AppError("No active time tracking session found for this contract.", 404));
  }

  // Update session
  activeSession.endTime = new Date();
  activeSession.status = "submitted";
  if (description?.trim()) {
    activeSession.description = description.trim();
  }

  await activeSession.save();

  logger.info(`Time tracking stopped for contract ${contractId} by tasker ${taskerId}. Hours: ${activeSession.hoursWorked}`);

  res.status(200).json({
    status: "success",
    message: "Time tracking stopped successfully",
    data: { timeEntry: activeSession }
  });
});

// Get time entries for a contract
export const getTimeEntries = catchAsync(async (req, res, next) => {
  const { contractId } = req.params;
  const { status, page = 1, limit = 20 } = req.query;
  const userId = req.user.id;

  // Validate contract and user access
  const contract = await Contract.findById(contractId);
  if (!contract) {
    return next(new AppError("Contract not found.", 404));
  }

  // Check if user is either provider or tasker
  if (contract.provider.toString() !== userId && contract.tasker.toString() !== userId) {
    return next(new AppError("You are not authorized to view time entries for this contract.", 403));
  }

  // Build query
  const query = { contract: contractId };
  if (status && status !== 'all') {
    query.status = status;
  }

  // Get time entries with pagination
  const skip = (parseInt(page) - 1) * parseInt(limit);
  const timeEntries = await TimeEntry.find(query)
    .populate('tasker', 'firstName lastName profileImage')
    .sort({ startTime: -1 })
    .skip(skip)
    .limit(parseInt(limit));

  const total = await TimeEntry.countDocuments(query);

  // Calculate totals
  const totals = await TimeEntry.aggregate([
    { $match: { contract: mongoose.Types.ObjectId(contractId) } },
    {
      $group: {
        _id: "$status",
        totalHours: { $sum: "$hoursWorked" },
        totalPayment: { $sum: "$sessionPayment" },
        count: { $sum: 1 }
      }
    }
  ]);

  res.status(200).json({
    status: "success",
    results: timeEntries.length,
    totalResults: total,
    data: {
      timeEntries,
      totals: totals.reduce((acc, item) => {
        acc[item._id] = {
          hours: item.totalHours,
          payment: item.totalPayment,
          count: item.count
        };
        return acc;
      }, {})
    }
  });
});

// Approve or reject time entries (Provider only)
export const reviewTimeEntry = catchAsync(async (req, res, next) => {
  const { timeEntryId } = req.params;
  const { action, notes } = req.body; // action: 'approve' or 'reject'
  const providerId = req.user.id;

  // Validate input
  if (!['approve', 'reject'].includes(action)) {
    return next(new AppError("Action must be either 'approve' or 'reject'.", 400));
  }

  // Find time entry
  const timeEntry = await TimeEntry.findById(timeEntryId).populate('contract');
  if (!timeEntry) {
    return next(new AppError("Time entry not found.", 404));
  }

  // Check if user is the provider
  if (timeEntry.provider.toString() !== providerId) {
    return next(new AppError("You are not authorized to review this time entry.", 403));
  }

  // Check if time entry is in submitted status
  if (timeEntry.status !== "submitted") {
    return next(new AppError("Only submitted time entries can be reviewed.", 400));
  }

  // Update time entry
  timeEntry.status = action === 'approve' ? 'approved' : 'rejected';
  timeEntry.providerNotes = notes?.trim() || "";
  timeEntry.reviewedAt = new Date();

  await timeEntry.save();

  // If approved, update contract's actual hours and total payment
  if (action === 'approve') {
    const contract = timeEntry.contract;
    contract.actualHours = (contract.actualHours || 0) + timeEntry.hoursWorked;
    contract.totalHourlyPayment = (contract.totalHourlyPayment || 0) + timeEntry.sessionPayment;
    await contract.save();
  }

  logger.info(`Time entry ${timeEntryId} ${action}ed by provider ${providerId}`);

  res.status(200).json({
    status: "success",
    message: `Time entry ${action}ed successfully`,
    data: { timeEntry }
  });
});

// Get active time tracking session for a tasker
export const getActiveSession = catchAsync(async (req, res, next) => {
  const { contractId } = req.params;
  const taskerId = req.user.id;

  const activeSession = await TimeEntry.findOne({
    tasker: taskerId,
    contract: contractId,
    status: "active"
  });

  res.status(200).json({
    status: "success",
    data: { activeSession }
  });
});

// Get time tracking summary for a contract
export const getTimeTrackingSummary = catchAsync(async (req, res, next) => {
  const { contractId } = req.params;
  const userId = req.user.id;

  // Validate contract and user access
  const contract = await Contract.findById(contractId).populate('gig', 'title isHourly');
  if (!contract) {
    return next(new AppError("Contract not found.", 404));
  }

  // Check if user is either provider or tasker
  if (contract.provider.toString() !== userId && contract.tasker.toString() !== userId) {
    return next(new AppError("You are not authorized to view this contract's time tracking.", 403));
  }

  // Get summary data
  const summary = await TimeEntry.aggregate([
    { $match: { contract: mongoose.Types.ObjectId(contractId) } },
    {
      $group: {
        _id: "$status",
        totalHours: { $sum: "$hoursWorked" },
        totalPayment: { $sum: "$sessionPayment" },
        sessionCount: { $sum: 1 }
      }
    }
  ]);

  // Get active session if user is tasker
  let activeSession = null;
  if (contract.tasker.toString() === userId) {
    activeSession = await TimeEntry.findOne({
      tasker: userId,
      contract: contractId,
      status: "active"
    });
  }

  const summaryData = summary.reduce((acc, item) => {
    acc[item._id] = {
      hours: item.totalHours,
      payment: item.totalPayment,
      sessions: item.sessionCount
    };
    return acc;
  }, {});

  res.status(200).json({
    status: "success",
    data: {
      contract: {
        id: contract._id,
        isHourly: contract.isHourly,
        hourlyRate: contract.hourlyRate,
        estimatedHours: contract.estimatedHours,
        actualHours: contract.actualHours,
        totalHourlyPayment: contract.totalHourlyPayment,
        gig: contract.gig
      },
      summary: summaryData,
      activeSession
    }
  });
});