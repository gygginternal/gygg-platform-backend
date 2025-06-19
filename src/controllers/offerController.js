import { Offer } from "../models/Offer.js";
import Contract from "../models/Contract.js"; // Import the Contract model
import ChatMessage from "../models/ChatMessage.js"; // Import ChatMessage model
import catchAsync from "../utils/catchAsync.js";
import AppError from "../utils/AppError.js";
import Notification from '../models/Notification.js';
import logger from '../utils/logger.js';
import notifyAdmin from '../utils/notifyAdmin.js';

/**
 * Controller to accept an offer.
 * @param {object} req - The request object.
 * @param {object} res - The response object.
 * @param {function} next - The next middleware function.
 */
export const acceptOffer = catchAsync(async (req, res, next) => {
  const { offerId } = req.params;

  // Validate that the offer exists
  const offer = await Offer.findById(offerId).populate("application gig");
  if (!offer) {
    return next(new AppError("Offer not found.", 404));
  }

  // Ensure the logged-in user is the tasker
  if (offer.tasker.toString() !== req.user.id) {
    return next(
      new AppError("You are not authorized to accept this offer.", 403)
    );
  }

  // Validate the application and gig statuses
  const application = offer.application;
  const gig = offer.gig;

  if (!application || !gig) {
    return next(new AppError("Associated application or gig not found.", 404));
  }

  if (application.status === "accepted") {
    return next(
      new AppError("This application has already been accepted.", 400)
    );
  }

  if (gig.status === "assigned") {
    return next(new AppError("This gig has already been assigned.", 400));
  }

  // Update the offer status to "accepted"
  offer.status = "accepted";
  await offer.save();

  // Update the application status to "accepted"
  application.status = "accepted";
  await application.save();

  // Update the gig status to "assigned"
  gig.status = "assigned";
  gig.assignedTasker = offer.tasker; // Assign the tasker to the gig
  await gig.save();

  // Create a new contract
  const contract = await Contract.create({
    gig: gig._id,
    provider: gig.postedBy, // Assuming `postedBy` is the provider
    tasker: offer.tasker, // The tasker assigned to the gig
    agreedCost: gig.cost, // Use the gig's cost as the agreed cost
    details: offer.offerDetails, // Include offer details in the contract
    status: "active", // Initial status of the contract
  });

  // Send a chat message to notify the provider
  await ChatMessage.create({
    contract: contract._id,
    sender: req.user.id, // Tasker who accepted the offer
    receiver: gig.postedBy, // Provider
    content: `Your offer has been accepted by ${req.user.firstName}.`,
  });

  res.status(200).json({
    status: "success",
    message: "Offer accepted and contract created successfully.",
    data: {
      contract,
    },
  });
});

export const declineOffer = catchAsync(async (req, res, next) => {
  const { offerId } = req.params;

  // Validate that the offer exists
  const offer = await Offer.findById(offerId);
  if (!offer) {
    return next(new AppError("Offer not found.", 404));
  }

  // Ensure the logged-in user is the tasker
  if (offer.tasker.toString() !== req.user.id) {
    return next(
      new AppError("You are not authorized to decline this offer.", 403)
    );
  }

  // Update the offer status to "declined"
  offer.status = "declined";
  await offer.save();

  res.status(200).json({
    status: "success",
    message: "Offer declined successfully.",
  });
});

/**
 * Controller to delete an offer.
 * @param {object} req - The request object.
 * @param {object} res - The response object.
 * @param {function} next - The next middleware function.
 */
export const deleteOffer = catchAsync(async (req, res, next) => {
  const offerId = req.params.id;
  const offer = await Offer.findById(offerId);
  if (!offer) return next(new AppError('No offer found with that ID', 404));
  // Only provider, tasker, or admin can delete
  if (![offer.provider.toString(), offer.tasker.toString()].includes(req.user.id) && !req.user.role.includes('admin')) {
    return next(new AppError('You do not have permission to delete this offer.', 403));
  }
  // Cascade delete related notifications
  await Notification.deleteMany({ 'data.offerId': offerId });
  await Offer.findByIdAndDelete(offerId);
  logger.warn(`Offer ${offerId} deleted by user ${req.user.id}`);
  await notifyAdmin('Offer deleted', { offerId, deletedBy: req.user.id });
  res.status(204).json({ status: 'success', data: null });
});

/**
 * Controller to get the offer of an application.
 * @param {object} req - The request object.
 * @param {object} res - The response object.
 * @param {function} next - The next middleware function.
 */
export const getOfferByApplication = catchAsync(async (req, res, next) => {
  const { gigId } = req.params; // Extract gig ID from route parameters

  // Find the offer for the given gig and populate the application field
  const offer = await Offer.findOne({ gig: gigId }).populate("provider");

  if (!offer) {
    return res.status(200).json({
      status: "success",
      data: {
        offer: null,
      },
    });
  }

  res.status(200).json({
    status: "success",
    data: {
      offer,
    },
  });
});
