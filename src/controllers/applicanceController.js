import Applicance from "../models/Applicance.js";
import { Gig } from "../models/Gig.js";
import Contract from "../models/Contract.js";
import catchAsync from "../utils/catchAsync.js";
import AppError from "../utils/AppError.js";

export const listGigApplications = catchAsync(async (req, res, next) => {
  const { gigId } = req.params;

  // Check if there are any applications for the gig
  const applications = await Applicance.find({ gig: gigId }).populate("user");

  // Format the response to match the desired structure
  const formattedApplications = applications.map((application) => {
    const user = application.user;
    return {
      id: application._id,
      name: `${user.firstName}.${user.lastName.charAt(0)}`, // Format name as "FirstName.T"
      location: `${user.address.city}, ${user.address.state}`, // Combine city and state
      description: user.bio, // Use bio for the description
      services: user.skills, // Use skills as services
      image: user.profileImage || "/default.png", // Use profileImage or fallback to /default.png
      status: application.status, // Status of the application
    };
  });

  res.status(200).json({
    status: "success",
    results: formattedApplications.length,
    data: {
      applications: formattedApplications,
    },
  });
});

export const applyToGig = catchAsync(async (req, res, next) => {
  const { gigId } = req.params;
  const user = req.user._id; // Logged-in tasker

  // Check if the gig exists
  const gig = await Gig.findById(gigId);
  if (!gig) {
    return next(new AppError("Gig not found.", 404));
  }

  // Check if the applicance already exists
  const existingApplicance = await Applicance.findOne({ user, gig: gigId });
  if (existingApplicance) {
    return next(new AppError("You have already applied for this gig.", 400));
  }

  // Create a new applicance
  const applicance = await Applicance.create({
    user,
    gig: gigId,
    status: "pending",
  });

  res.status(201).json({
    status: "success",
    data: {
      applicance,
    },
  });
});

export const offerApplication = catchAsync(async (req, res, next) => {
  const { applicationId } = req.params;

  // Find the application by ID
  const application = await Applicance.findById(applicationId).populate("gig");

  if (!application) {
    return next(new AppError("Application not found.", 404));
  }

  // Check if the application is already accepted
  if (application.status === "accepted") {
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
  gig.assignedTasker = application.user; // Assign the tasker to the gig
  await gig.save();

  // Create a new contract
  const contract = await Contract.create({
    gig: gig._id,
    provider: gig.postedBy, // Assuming `postedBy` is the provider
    tasker: application.user, // The tasker assigned to the gig
    agreedCost: gig.cost, // Use the gig's cost as the agreed cost
    status: "pending_payment", // Initial status of the contract
  });

  res.status(200).json({
    status: "success",
    data: {
      application,
      gig,
      contract,
    },
  });
});

export const rejectApplicance = catchAsync(async (req, res, next) => {
  const { applicanceId } = req.params;

  // Find the applicance and update its status to "rejected"
  const applicance = await Applicance.findByIdAndUpdate(
    applicanceId,
    { status: "rejected" },
    { new: true, runValidators: true }
  );

  if (!applicance) {
    return next(new AppError("Applicance not found.", 404));
  }

  res.status(200).json({
    status: "success",
    data: {
      applicance,
    },
  });
});
