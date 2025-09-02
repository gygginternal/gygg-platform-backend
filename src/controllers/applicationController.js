import Application from "../models/Application.js";
import { Gig } from "../models/Gig.js";
import Contract from "../models/Contract.js";
import catchAsync from "../utils/catchAsync.js";
import AppError from "../utils/AppError.js";
import app from "../app.js";
import { Offer } from "../models/Offer.js"; // Import the Offer model
import User from "../models/User.js"; // Import the User model
import Notification from '../models/Notification.js';
import logger from '../utils/logger.js';
import notifyAdmin from '../utils/notifyAdmin.js';

export const createOffer = catchAsync(async (req, res, next) => {
  const { applicationId } = req.params; // Extract application ID from route parameters

  // Validate that the application exists
  const application = await Application.findById(applicationId).populate("gig");
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

  // Fetch the gig to get provider's preferences
  const gig = await Gig.findById(gigId).populate('postedBy', 'hobbies peoplePreference skills');
  if (!gig) {
    return next(new AppError("Gig not found.", 404));
  }

  // Fetch applications for the gig, excluding those with status "cancelled"
  const applications = await Application.find({
    gig: gigId,
    status: { $ne: "cancelled" },
  }).populate("user", "firstName lastName email bio hobbies skills peoplePreference profileImage address rating ratingCount");

  // Calculate compatibility scores and format applications
  const formattedApplications = applications.map((application) => {
    const user = application.user;
    
    // Safely format location with null checks
    let location = "Location not specified";
    if (user.address && user.address.city && user.address.state) {
      location = `${user.address.city}, ${user.address.state}`;
    } else if (user.address && user.address.city) {
      location = user.address.city;
    } else if (user.address && user.address.state) {
      location = user.address.state;
    }

    // Calculate compatibility score based on hobbies and preferences
    const compatibilityScore = calculateCompatibilityScore(gig.postedBy, user);
    
    return {
      id: application._id,
      name: `${user.firstName} ${user.lastName}`,
      location: location,
      description: user.bio || "No bio provided",
      services: user.skills || [],
      hobbies: user.hobbies || [],
      image: user.profileImage || "/default.png",
      status: application.status,
      rating: user.rating || 0,
      ratingCount: user.ratingCount || 0,
      compatibilityScore: compatibilityScore,
      matchingHobbies: getMatchingHobbies(gig.postedBy.hobbies || [], user.hobbies || []),
      matchingSkills: getMatchingSkills(gig.skills || [], user.skills || []),
    };
  });

  // Sort applications by compatibility score (highest first), then by rating
  const sortedApplications = formattedApplications.sort((a, b) => {
    // First sort by compatibility score
    if (b.compatibilityScore !== a.compatibilityScore) {
      return b.compatibilityScore - a.compatibilityScore;
    }
    // Then by rating if compatibility scores are equal
    return b.rating - a.rating;
  });

  res.status(200).json({
    status: "success",
    results: sortedApplications.length,
    data: {
      applications: sortedApplications,
    },
  });
});

// Helper function to calculate compatibility score between provider and tasker
function calculateCompatibilityScore(provider, tasker) {
  let score = 0;
  const maxScore = 100;

  // Hobby matching (40% of total score)
  const providerHobbies = provider.hobbies || [];
  const taskerHobbies = tasker.hobbies || [];
  const matchingHobbies = getMatchingHobbies(providerHobbies, taskerHobbies);
  
  if (providerHobbies.length > 0) {
    const hobbyScore = (matchingHobbies.length / providerHobbies.length) * 40;
    score += hobbyScore;
  }

  // Skills matching (30% of total score)
  const providerSkills = provider.skills || [];
  const taskerSkills = tasker.skills || [];
  const matchingSkills = getMatchingSkills(providerSkills, taskerSkills);
  
  if (providerSkills.length > 0) {
    const skillScore = (matchingSkills.length / providerSkills.length) * 30;
    score += skillScore;
  }

  // People preference matching (20% of total score)
  const providerPreferences = provider.peoplePreference || [];
  const taskerPreferences = tasker.peoplePreference || [];
  
  if (providerPreferences.length > 0 && taskerPreferences.length > 0) {
    const preferenceMatches = providerPreferences.filter(pref => 
      taskerPreferences.some(tPref => 
        pref.toLowerCase().includes(tPref.toLowerCase()) || 
        tPref.toLowerCase().includes(pref.toLowerCase())
      )
    );
    const preferenceScore = (preferenceMatches.length / providerPreferences.length) * 20;
    score += preferenceScore;
  }

  // Rating bonus (10% of total score)
  const ratingBonus = (tasker.rating || 0) * 2; // Max 10 points for 5-star rating
  score += ratingBonus;

  return Math.min(Math.round(score), maxScore);
}

// Helper function to get matching hobbies
function getMatchingHobbies(providerHobbies, taskerHobbies) {
  return providerHobbies.filter(hobby => 
    taskerHobbies.some(tHobby => 
      hobby.toLowerCase() === tHobby.toLowerCase()
    )
  );
}

// Helper function to get matching skills
function getMatchingSkills(requiredSkills, taskerSkills) {
  return requiredSkills.filter(skill => 
    taskerSkills.some(tSkill => 
      skill.toLowerCase() === tSkill.toLowerCase()
    )
  );
}

export const applyToGig = catchAsync(async (req, res, next) => {
  const { gigId } = req.params;
  const user = req.user._id; // Logged-in tasker

  // Check if the gig exists
  const gig = await Gig.findById(gigId);
  if (!gig) {
    return next(new AppError("Gig not found.", 404));
  }

  // Check if the application already exists
  const existingApplication = await Application.findOne({ user, gig: gigId });

  if (existingApplication) {
    if (existingApplication.status === "cancelled") {
      existingApplication.status = "pending"; // Reopen the application if it was cancelled
      await existingApplication.save();

      return res.status(201).json({
        status: "success",
        data: {
          application: existingApplication,
        },
      });
    }

    return next(new AppError("You have already applied for this gig.", 400));
  }

  // Create a new application
  const application = await Application.create({
    user,
    gig: gigId,
    status: "pending",
  });

  res.status(201).json({
    status: "success",
    data: {
      application,
    },
  });
});

export const offerApplication = catchAsync(async (req, res, next) => {
  const { applicationId } = req.params;

  // Find the application by ID
  const application = await Application.findById(applicationId).populate("gig");

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
    provider: gig.postedBy._id || gig.postedBy, // Handle both populated and unpopulated cases
    tasker: application.user, // The tasker assigned to the gig
    agreedCost: gig.cost, // Use the gig's cost as the agreed cost
    status: "pending_payment", // Set to pending_payment since tasker is automatically accepted
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

export const rejectApplication = catchAsync(async (req, res, next) => {
  const { applicationId } = req.params;

  // Find the application and update its status to "rejected"
  const application = await Application.findByIdAndUpdate(
    applicationId,
    { status: "rejected" },
    { new: true, runValidators: true }
  );

  if (!application) {
    return next(new AppError("Application not found.", 404));
  }

  res.status(200).json({
    status: "success",
    data: {
      application,
    },
  });
});

export const cancelApplication = catchAsync(async (req, res, next) => {
  const { applicationId } = req.params;

  // Find the application by ID
  const application = await Application.findById(applicationId);

  if (!application) {
    return next(new AppError("Application not found.", 404));
  }

  // Check if the logged-in user is the owner of the application
  if (application.user.toString() !== req.user._id.toString()) {
    return next(
      new AppError("You are not authorized to cancel this application.", 403)
    );
  }

  // Update the application status to "cancelled"
  application.status = "cancelled";
  await application.save();

  res.status(200).json({
    status: "success",
    message: "Application successfully cancelled.",
    data: {
      application,
    },
  });
});

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

  // Find all applications for user's gigs
  const applications = await Application.find({
    gig: { $in: gigIds },
    status: "pending" // Only show pending applications
  })
  .populate("user", "firstName lastName email bio hobbies skills peoplePreference profileImage address rating ratingCount")
  .populate("gig", "title description hobbies skills");

  // Calculate compatibility scores for each application
  const scoredApplications = applications.map(application => {
    const tasker = application.user;
    const gig = application.gig;
    
    // Safely format location
    let location = "Location not specified";
    if (tasker.address && tasker.address.city && tasker.address.state) {
      location = `${tasker.address.city}, ${tasker.address.state}`;
    } else if (tasker.address && tasker.address.city) {
      location = tasker.address.city;
    } else if (tasker.address && tasker.address.state) {
      location = tasker.address.state;
    }

    const compatibilityScore = calculateCompatibilityScore(user, tasker);
    const matchingHobbies = getMatchingHobbies(user.hobbies || [], tasker.hobbies || []);
    const matchingSkills = getMatchingSkills(gig.skills || [], tasker.skills || []);

    return {
      id: application._id,
      gigId: gig._id,
      gigTitle: gig.title,
      name: `${tasker.firstName} ${tasker.lastName}`,
      location: location,
      description: tasker.bio || "No bio provided",
      services: tasker.skills || [],
      hobbies: tasker.hobbies || [],
      image: tasker.profileImage || "/default.png",
      status: application.status,
      rating: tasker.rating || 0,
      ratingCount: tasker.ratingCount || 0,
      compatibilityScore: compatibilityScore,
      matchingHobbies: matchingHobbies,
      matchingSkills: matchingSkills,
      appliedAt: application.createdAt
    };
  });

  // Sort by compatibility score (highest first) and limit results
  const topMatches = scoredApplications
    .sort((a, b) => b.compatibilityScore - a.compatibilityScore)
    .slice(0, parseInt(limit));

  res.status(200).json({
    status: "success",
    results: topMatches.length,
    data: {
      applications: topMatches,
      totalApplications: applications.length,
      averageCompatibility: topMatches.length > 0 
        ? Math.round(topMatches.reduce((sum, app) => sum + app.compatibilityScore, 0) / topMatches.length)
        : 0
    },
  });
});

export const deleteApplication = catchAsync(async (req, res, next) => {
  const applicationId = req.params.id;
  const application = await Application.findById(applicationId);
  if (!application) return next(new AppError('No application found with that ID', 404));
  // Only user or admin can delete
  if (
    application.user.toString() !== req.user._id.toString() &&
    req.user.role !== 'admin'
  ) {
    return next(new AppError('You are not authorized to delete this application', 403));
  }
  await Promise.all([
    Notification.deleteMany({ 'data.applicationId': applicationId }),
  ]);
  await Application.findByIdAndDelete(applicationId);
  logger.warn(`Application ${applicationId} and related data deleted by user ${req.user.id}`);
  await notifyAdmin('Application deleted', { applicationId, deletedBy: req.user.id });
  res.status(204).json({ status: 'success', data: null });
});

export const getMyAppliedGigs = catchAsync(async (req, res, next) => {
  const userId = req.user._id;
  // Find all applications for the current user, populate gig details
  const applications = await Application.find({ user: userId })
    .populate('gig');
  
  // Map to include both gig details and application info
  const gigsWithApplications = applications
    .filter(app => app.gig) // Filter out null gigs
    .map(app => ({
      ...app.gig.toObject(),
      applicationId: app._id,
      applicationStatus: app.status
    }));
  
  res.status(200).json({ 
    status: 'success', 
    results: gigsWithApplications.length, 
    data: gigsWithApplications 
  });
}); 