import Applicance from "../models/Applicance.js";
import { Gig } from "../models/Gig.js";
import Contract from "../models/Contract.js";
import catchAsync from "../utils/catchAsync.js";
import AppError from "../utils/AppError.js";
import app from "../app.js";
import { Offer } from "../models/Offer.js"; // Import the Offer model

/**
 * Controller to create an offer for an application.
 * @param {object} req - The request object.
 * @param {object} res - The response object.
 * @param {function} next - The next middleware function.
 */
export const createOffer = catchAsync(async (req, res, next) => {
  const { applicationId } = req.params; // Extract application ID from route parameters

  // Validate that the application exists
  const application = await Applicance.findById(applicationId).populate("gig");
  if (!application) {
    return next(new AppError("Application not found.", 404));
  }

  // Ensure the logged-in user is the provider who posted the gig
  const gig = application.gig;

  if (gig.postedBy._id.toString() !== req.user.id) {
    return next(
      new AppError(
        "You are not authorized to create an offer for this application.",
        403
      )
    );
  }

  // Check if an offer already exists for this application
  const existingOffer = await Offer.findOne({ application: applicationId });
  if (existingOffer) {
    return next(
      new AppError(
        "An offer has already been created for this application.",
        400
      )
    );
  }

  // Create the offer
  const offer = await Offer.create({
    application: applicationId,
    gig: gig._id, // Save the gig ID
    provider: req.user.id,
    tasker: application.user,
    status: "pending",
  });

  res.status(201).json({
    status: "success",
    message: "Offer created successfully.",
    data: {
      offer,
    },
  });
});

export const listGigApplications = catchAsync(async (req, res, next) => {
  const { gigId } = req.params;

  // Fetch applications for the gig, excluding those with status "cancelled"
  const applications = await Applicance.find({
    gig: gigId,
    status: { $ne: "cancelled" },
  }).populate("user");

  // Format the response to match the desired structure
  const formattedApplications = applications.map((application) => {
    const user = application.user;
    return {
      id: application._id,
      name: `${user.firstName} ${user.lastName}`, // Format name as "FirstName.T"
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
    if (existingApplicance.status === "cancelled") {
      existingApplicance.status = "pending"; // Reopen the application if it was cancelled
      await existingApplicance.save();

      return res.status(201).json({
        status: "success",
        data: {
          applicance: existingApplicance,
        },
      });
    }

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
    status: "active", // Initial status of the contract
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

export const cancelApplicance = catchAsync(async (req, res, next) => {
  const { applicanceId } = req.params;

  // Find the application by ID
  const applicance = await Applicance.findById(applicanceId);

  if (!applicance) {
    return next(new AppError("Applicance not found.", 404));
  }

  // Check if the logged-in user is the owner of the application
  if (applicance.user.toString() !== req.user._id.toString()) {
    return next(
      new AppError("You are not authorized to cancel this application.", 403)
    );
  }

  // Update the application status to "cancelled"
  applicance.status = "cancelled";
  await applicance.save();

  res.status(200).json({
    status: "success",
    message: "Application successfully cancelled.",
    data: {
      applicance,
    },
  });
});

export const topMatchApplicances = catchAsync(async (req, res, next) => {
  const user = req.user;
  const userHobbies = user.hobbies || [];
  const userPreferences = user.peoplePreference || [];
  const userId = user._id;

  console.log(
    `topMatchApplicances: User ${userId} searching for top appliances. Hobbies: [${userHobbies.join(
      ", "
    )}], Preferences: [${userPreferences.join(", ")}]`
  );

  const pipeline = [];

  // Match appliances associated with gigs
  pipeline.push({
    $lookup: {
      from: "gigs", // MongoDB collection for gigs
      localField: "gig",
      foreignField: "_id",
      as: "gigDetails",
    },
  });

  // Unwind gigDetails array to make it a single object
  pipeline.push({
    $unwind: "$gigDetails",
  });

  // Lookup the user who applied for the appliance
  pipeline.push({
    $lookup: {
      from: "users", // MongoDB collection for users
      localField: "user",
      foreignField: "_id",
      as: "applicant",
    },
  });

  // Unwind applicant array to make it a single object
  pipeline.push({
    $unwind: "$applicant",
  });

  // Calculate matchScore based on the overlap between the applicant's attributes and the user's attributes
  pipeline.push({
    $addFields: {
      matchScore: {
        $add: [
          {
            $size: {
              $setIntersection: [
                { $ifNull: ["$applicant.hobbies", []] }, // Default to empty array if null
                userHobbies,
              ],
            },
          }, // Overlap in hobbies
          {
            $size: {
              $setIntersection: [
                { $ifNull: ["$applicant.peoplePreference", []] }, // Default to empty array if null
                userPreferences,
              ],
            },
          }, // Overlap in peoplePreference
        ],
      },
    },
  });

  // Sort by matchScore in descending order
  pipeline.push({ $sort: { matchScore: -1, createdAt: -1 } });

  // Limit to top 3 appliances
  pipeline.push({ $limit: 3 });

  // Project fields to match the desired response structure
  pipeline.push({
    $project: {
      id: "$_id", // Use MongoDB's _id as the id
      description: {
        $concat: [
          "$applicant.firstName",
          ". ",
          { $substr: ["$applicant.lastName", 0, 1] },
          " applied for ",
          "$gigDetails.title",
        ],
      },
      applianceId: "$_id",
      gigId: "$gigDetails._id", // Include the gig ID
      matchScore: 1, // Include matchScore in the response
    },
  });

  const matchedApplicances = await Applicance.aggregate(pipeline);

  console.log(
    `topMatchApplicances: Found ${matchedApplicances.length} appliances for user ${userId}.`
  );

  res.status(200).json({
    status: "success",
    results: matchedApplicances.length,
    data: matchedApplicances,
  });
});
