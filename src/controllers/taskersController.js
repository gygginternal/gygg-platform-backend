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
  pipeline.push({ $sort: { matchScore: -1 } });

  // Project fields to match the mocked response

  // {
  //             "_id": "682d3c2a19a3cd652df42252",
  //             "name": "User1 Test",
  //             "rate": "$10/hr",
  //             "location": ", ",
  //             "description": "Lorem ipsum",
  //             "services": [
  //                 "Reading",
  //                 "Cooking",
  //                 "Running",
  //                 "Music",
  //                 "Traveling"
  //             ],
  //             "image": "https://example.com/profile.jpg"
  //         },

  pipeline.push({
    $project: {
      name: {
        $concat: [
          { $ifNull: ["$firstName", ""] },
          " ",
          { $ifNull: ["$lastName", ""] },
        ],
      },
      rate: {
        $concat: [
          { $literal: "$" },
          { $toString: { $ifNull: ["$ratePerHour", 0] } },
          "/hr",
        ],
      },
      location: {
        $concat: [
          { $ifNull: ["$address.city", ""] },
          ", ",
          { $ifNull: ["$address.state", ""] },
        ],
      },
      description: { $ifNull: ["$bio", ""] },
      services: { $ifNull: ["$hobbies", []] },
      image: {
        $cond: {
          if: { $ne: ["$profileImage", null] },
          then: "$profileImage",
          else: "/default.png",
        },
      },
    },
  });

  const matchedUsers = await User.aggregate(pipeline);

  logger.info(
    `matchTaskers: Found ${matchedUsers.length} users for tasker ${taskerId}.`
  );

  res.status(200).json(matchedUsers);
});
