import catchAsync from "../utils/catchAsync.js";
import User from "../models/User.js";
import logger from "../utils/logger.js";

export const matchTaskers = catchAsync(async (req, res, next) => {
  const tasker = req.user;
  const taskerHobbies = tasker.hobbies || [];
  const taskerPreferences = tasker.peoplePreference || [];
  const taskerId = tasker._id;

  logger.debug(
    `matchTaskers: Tasker ${taskerId} searching. Hobbies: [${taskerHobbies.join(
      ", "
    )}], Preferences: [${taskerPreferences.join(", ")}]`
  );

  const pipeline = [];
  pipeline.push({
    $match: { role: "tasker", active: true, _id: { $ne: taskerId } },
  });

  const matchOrConditions = [];
  if (taskerPreferences.length > 0) {
    matchOrConditions.push({
      peoplePreference: { $in: taskerPreferences },
    });
  }
  if (taskerHobbies.length > 0) {
    matchOrConditions.push({ hobbies: { $in: taskerHobbies } });
  }

  if (matchOrConditions.length > 0) {
    pipeline.push({ $match: { $or: matchOrConditions } });
  }

  // Calculate matchScore based on the amount of overlap
  pipeline.push({
    $addFields: {
      matchScore: {
        $add: [
          { $size: { $setIntersection: ["$hobbies", taskerHobbies] } }, // Overlap in hobbies
          {
            $size: {
              $setIntersection: ["$peoplePreference", taskerPreferences],
            },
          }, // Overlap in peoplePreference
        ],
      },
    },
  });

  // Remove users with no overlap (matchScore = 0)
  pipeline.push({
    $match: { matchScore: { $gt: 0 } },
  });

  // Sort by matchScore in descending order
  pipeline.push({ $sort: { matchScore: -1, rating: -1, ratingCount: -1 } });

  // Pagination
  const page = req.query.page * 1 || 1;
  const limit = req.query.limit * 1 || 10;
  const skip = (page - 1) * limit;
  pipeline.push({ $skip: skip });
  pipeline.push({ $limit: limit });

  // Project fields to match the mocked response
  pipeline.push({
    $project: {
      id: "$_id", // Use MongoDB's _id as the id
      name: { $concat: ["$firstName", ".", { $substr: ["$lastName", 0, 1] }] }, // Format name as "FirstName.T"
      rate: {
        $concat: [
          { $literal: "$" },
          { $toString: { $ifNull: ["$ratePerHour", 0] } },
          "/hr",
        ],
      },
      location: {
        $concat: ["$address.city", ", ", "$address.state"], // Combine city and state
      },
      description: "$bio", // Use bio for the description
      services: "$skills", // Use skills as services
      image: {
        $ifNull: ["$profileImage", "/default.png"], // Use profileImage or fallback to /default.png
      },
      matchScore: 1, // Include matchScore in the response
    },
  });

  const matchedTaskers = await User.aggregate(pipeline);

  logger.info(
    `matchTaskers: Found ${matchedTaskers.length} taskers for tasker ${taskerId}.`
  );

  res.status(200).json(matchedTaskers);
});
