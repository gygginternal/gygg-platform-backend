// Importing required modules
import User from "../models/User.js";
import Post from "../models/Post.js";
import AppError from "../utils/AppError.js";
import catchAsync from "../utils/catchAsync.js";
import mongoose from "mongoose";
import logger from "../utils/logger.js";

// Utility function to check if the user is the owner of the post or has admin privileges
const checkOwnershipOrAdmin = (resourceUserId, requestingUser) => {
  if (
    resourceUserId.toString() !== requestingUser.id &&
    !requestingUser.role.includes("admin")
  ) {
    throw new AppError(
      "You do not have permission to perform this action",
      403
    );
  }
  return true; // Return true if the user is authorized
};

// Route handler to get the feed of posts with sorting, pagination, and optional geolocation filtering
export const getPostFeed = catchAsync(async (req, res, next) => {
  // Destructure query parameters with default values
  const {
    sort = "recents",
    lat,
    lng,
    distance,
    page = 1,
    limit = 10,
  } = req.query;

  // Convert page and limit to integers
  const pageNum = parseInt(page, 10);
  const limitNum = parseInt(limit, 10);
  const skip = (pageNum - 1) * limitNum;

  // Initialize query and sorting options
  let query = Post.find();
  let sortOptions = {};

  console.log(
    `Fetching post feed | sort: ${sort} | page: ${pageNum} | limit: ${limitNum}`
  );

  // --- Handle Sorting Options ---
  switch (sort) {
    case "trending":
      // Trending = Most liked and recent
      sortOptions = { likeCount: -1, createdAt: -1 };
      break;

    case "near_me":
      // Validate latitude and longitude
      if (!lat || !lng) {
        return next(
          new AppError(
            'Latitude (lat) and Longitude (lng) are required for "near me" sorting.',
            400
          )
        );
      }

      const latitude = parseFloat(lat);
      const longitude = parseFloat(lng);

      if (isNaN(latitude) || isNaN(longitude)) {
        return next(new AppError("Invalid latitude or longitude values.", 400));
      }

      // Default max distance: 10km (converted to meters)
      const maxDistanceMeters = (parseFloat(distance) || 10) * 1000;

      // Apply geospatial query
      query = query.where("location").near({
        center: {
          type: "Point",
          coordinates: [longitude, latitude], // MongoDB requires [lng, lat]
        },
        maxDistance: maxDistanceMeters,
        spherical: true,
      });

      sortOptions = { createdAt: -1 }; // Near posts sorted by recency
      break;

    case "recents":
    default:
      sortOptions = { createdAt: -1 }; // Default to most recent posts
      break;
  }

  // Apply sorting, pagination, and projection (excluding __v)
  const posts = await query
    .sort(sortOptions)
    .skip(skip)
    .limit(limitNum)
    .select("-__v");

  // Send response
  res.status(200).json({
    status: "success",
    results: posts.length,
    data: { posts },
  });
});

// Route handler to get a single post by ID
export const getPost = catchAsync(async (req, res, next) => {
  const post = await Post.findById(req.params.id); // Find post by ID
  if (!post) {
    return next(new AppError("No post found with that ID", 404)); // Handle if post not found
  }
  res.status(200).json({ status: "success", data: { post } }); // Return post data
});

// Route handler to create a new post
export const createPost = catchAsync(async (req, res, next) => {
  const { content, media, tags, location } = req.body;

  // Validate location if provided
  let locationData;
  if (
    location &&
    location.coordinates &&
    Array.isArray(location.coordinates) &&
    location.coordinates.length === 2
  ) {
    locationData = {
      type: "Point",
      coordinates: [
        parseFloat(location.coordinates[0]),
        parseFloat(location.coordinates[1]),
      ], // Ensure correct coordinate order
      address: location.address, // Optional address
    };
  }

  // Create a new post with the provided data
  const newPost = await Post.create({
    author: req.user.id,
    content,
    media,
    tags,
    location: locationData,
  });

  // Return the created post data
  res.status(201).json({ status: "success", data: { post: newPost } });
});

// Route handler to update an existing post
export const updatePost = catchAsync(async (req, res, next) => {
  const post = await Post.findById(req.params.id); // Find the post by ID
  if (!post) {
    return next(new AppError("No post found with that ID", 404)); // Handle if post not found
  }

  // Check ownership or admin role before allowing update
  checkOwnershipOrAdmin(post.author, req.user);

  // Allowed fields for update
  const allowedUpdates = {};
  ["content", "media", "tags"].forEach((field) => {
    if (req.body[field] !== undefined) allowedUpdates[field] = req.body[field];
  });

  // Update the post with allowed fields
  const updatedPost = await Post.findByIdAndUpdate(
    req.params.id,
    allowedUpdates,
    { new: true, runValidators: true }
  );

  // Return updated post data
  res.status(200).json({ status: "success", data: { post: updatedPost } });
});

// Route handler to get a posts based on userId
export const getUserPosts = catchAsync(async (req, res, next) => {
  const userId = req.params.userId; // Get userId from route parameter
  // Validation for userId format is handled by express-validator in routes

  logger.debug(`Fetching posts for user ID (dedicated endpoint): ${userId}`);

  // Check if user exists (optional, but good practice)
  const userExists = await User.findById(userId); // Assuming User model is imported
  if (!userExists) {
    return next(new AppError("User not found.", 404));
  }

  // Pagination
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const skip = (page - 1) * limit;

  const posts = await Post.find({ author: userId }) // Direct filter by author
    .sort({ createdAt: -1 }) // Default sort for user's posts
    .skip(skip)
    .limit(limit)
    .select("-__v"); // Population of author/comments handled by pre-find hook

  // Optional: Get total count for pagination
  const totalPosts = await Post.countDocuments({ author: userId });

  res.status(200).json({
    status: "success",
    results: posts.length,
    total: totalPosts,
    page: page,
    totalPages: Math.ceil(totalPosts / limit),
    data: {
      posts,
    },
  });
});

// Route handler to delete a post
export const deletePost = catchAsync(async (req, res, next) => {
  const post = await Post.findById(req.params.id); // Find the post by ID
  if (!post) {
    return next(new AppError("No post found with that ID", 404)); // Handle if post not found
  }

  // Check ownership or admin role before allowing deletion
  checkOwnershipOrAdmin(post.author, req.user);

  // Delete the post from the database
  await Post.findByIdAndDelete(req.params.id);

  // Return success response
  res.status(204).json({ status: "success", data: null });
});

// Route handler to like a post
export const likePost = catchAsync(async (req, res, next) => {
  const postId = req.params.id;
  const userId = req.user.id; // Get the logged-in user's ID

  // Find the post by ID
  const post = await Post.findById(postId);
  if (!post) {
    return next(new AppError("Post not found.", 404));
  }

  // Check if the user has already liked the post
  if (post.likes.includes(userId)) {
    return next(new AppError("You have already liked this post.", 400));
  }

  // Add the user's ID to the likes array and increment the likeCount
  post.likes.push(userId);
  post.likeCount += 1;

  // Save the updated post
  await post.save();

  res.status(200).json({
    status: "success",
    message: "Post liked successfully.",
    data: {
      post,
    },
  });
});

// Route handler to unlike a post
export const unlikePost = catchAsync(async (req, res, next) => {
  const postId = req.params.id;
  const userId = req.user.id; // Get the logged-in user's ID

  // Find the post by ID
  console.log({ postId });

  const post = await Post.findById(postId);
  if (!post) {
    return next(new AppError("Post not found.", 404));
  }

  // Check if the user has not liked the post
  if (!post.likes.includes(userId)) {
    return next(new AppError("You have not liked this post.", 400));
  }

  // Remove the user's ID from the likes array and decrement the likeCount
  post.likes = post.likes.filter((id) => id.toString() !== userId);
  if (post.likeCount > 0) {
    post.likeCount -= 1;
  }

  // Save the updated post
  await post.save();

  res.status(200).json({
    status: "success",
    message: "Post unliked successfully.",
    data: {
      post,
    },
  });
});

// Route handler to add a comment to a post
export const addComment = catchAsync(async (req, res, next) => {
  const { text } = req.body;
  const postId = req.params.id; // Get post ID from route params
  const userId = req.user.id; // Get logged-in user's ID from protect middleware

  if (!text || text.trim() === "") {
    return next(new AppError("Comment text cannot be empty", 400));
  }

  // Create a comment object with user and text
  const comment = {
    author: userId,
    text: text.trim(),
  };

  // Update the post with the new comment
  const post = await Post.findByIdAndUpdate(
    postId,
    {
      $push: { comments: comment },
      // $inc: { commentCount: 1 } // Optionally increment here or rely on pre-save hook
    },
    { new: true, runValidators: true } // runValidators for the main Post schema if needed
  ).populate("comments.author", "firstName lastName profileImage"); // Populate for response

  if (!post) {
    return next(new AppError("No post found with that ID", 404));
  }

  // If your Post model has a pre-save hook to update commentCount,
  // you might need to call post.save() if findByIdAndUpdate doesn't trigger it
  // for subdocument array changes for count.
  // However, if you incremented commentCount with $inc, post.save() isn't strictly for the count.
  // For the sake of ensuring the pre-save hook for commentCount runs (if it exists):
  // (This save also triggers the likeCount update if likes were modified, but they weren't here)
  await post.save({ validateBeforeSave: false }); // Call save to trigger hooks

  logger.info(`Comment added to post ${postId} by user ${userId}`);

  res.status(201).json({
    status: "success",
    data: {
      post, // Return the updated post with the new comment
    },
  });
});

// Route handler to delete a comment from a post
export const deleteComment = catchAsync(async (req, res, next) => {
  const { postId, commentId } = req.params;
  const post = await Post.findById(postId); // Find the post by ID

  if (!post) {
    return next(new AppError("Post not found", 404)); // Handle if post not found
  }

  // Find the comment by ID
  const comment = post.comments.id(commentId);
  if (!comment) {
    return next(new AppError("Comment not found", 404)); // Handle if comment not found
  }

  // Check if the user is allowed to delete the comment (either the comment's author or an admin)
  if (
    comment.user.toString() !== req.user.id &&
    !req.user.role.includes("admin")
  ) {
    return next(
      new AppError("You do not have permission to delete this comment", 403)
    );
  }

  // Remove the comment from the post's comments array
  comment.remove();
  await post.save(); // Save the post after removal

  res.status(204).json({ status: "success", data: null }); // Return success response
});
