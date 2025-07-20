// Importing required modules
import User from "../models/User.js";
import Post from "../models/Post.js";
import AppError from "../utils/AppError.js";
import catchAsync from "../utils/catchAsync.js";
import mongoose from "mongoose";
import logger from "../utils/logger.js";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import multer from "multer";
import { v4 as uuidv4 } from "uuid"; // For generating unique filenames
import Notification from '../models/Notification.js';
import { 
  analyzeImageContent,
  getImageViolationMessage,
  shouldBlockImage
} from "../utils/contentFilter.js";

// Configure AWS S3
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});



// Configure multer for file upload
const upload = multer({
  storage: multer.memoryStorage(), // Store files in memory for direct upload to S3
  limits: { fileSize: 5 * 1024 * 1024 }, // Limit file size to 5MB
});

// Utility function to check if the user is the owner of the post or has admin privileges
const checkOwnershipOrAdmin = (resourceUserId, requestingUser) => {
  // Handle both ObjectId and populated user object cases
  let resourceUserIdStr;
  
  if (typeof resourceUserId === 'object' && resourceUserId._id) {
    // If it's a populated user object, use the _id
    resourceUserIdStr = resourceUserId._id.toString();
  } else {
    // If it's an ObjectId, convert to string
    resourceUserIdStr = resourceUserId.toString();
  }
  
  const requestingUserIdStr = requestingUser.id.toString();
  
  if (
    resourceUserIdStr !== requestingUserIdStr &&
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

// Route handler to create a new post with image upload and content moderation
export const createPost = catchAsync(async (req, res, next) => {
  const { content } = req.body; // Extract content from form data

  // Validate content
  if (!content || content.trim() === "") {
    return next(new AppError("Content cannot be empty.", 400));
  }

  // Handle image upload to S3 with content moderation
  let mediaUrls = [];
  if (req.file) {
    const s3Key = req.file.key;
    const imageUrl = req.file.location;

    try {
      // Analyze image content for inappropriate material
      const moderationResult = await analyzeImageContent(s3Key);
      
      // If image contains inappropriate content, delete it and reject
      if (shouldBlockImage(moderationResult)) {
        // Delete the uploaded image from S3
        try {
          await s3Client.send(new DeleteObjectCommand({
            Bucket: process.env.AWS_S3_BUCKET_NAME,
            Key: s3Key,
          }));
        } catch (deleteError) {
          logger.error('Failed to delete inappropriate post image from S3:', deleteError);
        }

        // Log the violation
        logger.warn('Blocked inappropriate post image', {
          userId: req.user.id,
          fileName: req.file.originalname,
          labels: moderationResult.labels.map(l => l.Name),
          confidence: moderationResult.confidence
        });

        // Notify admin of the violation
        await notifyAdmin('Inappropriate post image blocked', {
          userId: req.user.id,
          fileName: req.file.originalname,
          labels: moderationResult.labels,
          s3Key
        });

        const errorMessage = getImageViolationMessage(moderationResult.violations, 'posted');
        return next(new AppError(errorMessage, 400));
      }

      // Image passed moderation, add to media URLs
      mediaUrls.push(imageUrl);
      
      logger.info(`Post image uploaded and approved: ${imageUrl}`, {
        userId: req.user.id,
        fileName: req.file.originalname,
        moderationPassed: true
      });

    } catch (error) {
      // If moderation fails, delete the image and return error
      try {
        await s3Client.send(new DeleteObjectCommand({
          Bucket: process.env.AWS_S3_BUCKET_NAME,
          Key: s3Key,
        }));
      } catch (deleteError) {
        logger.error('Failed to delete post image after moderation error:', deleteError);
      }

      logger.error('Post image moderation failed:', error);
      return next(new AppError("Failed to process image. Please try again.", 500));
    }
  }

  // Create a new post with the provided data
  const newPost = await Post.create({
    author: req.user.id,
    content: content.trim(),
    media: mediaUrls,
  });

  // Populate author fields for response
  await newPost.populate({
    path: 'author',
    select: 'firstName lastName profileImage',
  });

  // Return the created post data
  res.status(201).json({
    status: "success",
    data: { post: newPost },
  });
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

  // Always fetch only posts by this user, sorted by recency
  const posts = await Post.find({ author: userId })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .select("-__v");

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
  const post = await Post.findById(req.params.id);
  if (!post) return next(new AppError('No post found with that ID', 404));
  checkOwnershipOrAdmin(post.author, req.user);
  await deleteS3Media(post.media);
  await Post.findByIdAndDelete(post._id);
  logger.warn(`Post ${post._id} deleted by user ${req.user.id}`);
  await notifyAdmin('Post deleted', { postId: post._id, author: post.author });
  res.status(204).json({ status: 'success', data: null });
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

  if (post.author !== req.user.id) {
    await Notification.create({
      user: post.author,
      type: 'new_like',
      message: `${req.user.firstName} liked your post`,
      data: { postId: post._id },
      icon: 'post.svg',
      link: '/feed',
    });
  }

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
  await Post.findByIdAndUpdate(
    postId,
    {
      $push: { comments: comment },
    },
    { new: true, runValidators: true }
  );

  // Fetch the updated post and trigger pre-save hook
  const post = await Post.findById(postId).populate("comments.author", "firstName lastName profileImage");
  if (!post) {
    return next(new AppError("No post found with that ID", 404));
  }
  post.markModified('comments');
  await post.save({ validateBeforeSave: false });

  if (post.author !== req.user.id) {
    await Notification.create({
      user: post.author,
      type: 'new_comment',
      message: `${req.user.firstName} commented on your post`,
      data: { postId: post._id },
      icon: 'post.svg',
      link: '/feed',
    });
  }

  logger.info(`Comment added to post ${postId} by user ${userId}`);

  res.status(201).json({
    status: "success",
    data: {
      post,
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

  // Handle both ObjectId and populated user object cases for comment author
  let commentAuthorIdStr;
  if (typeof comment.author === 'object' && comment.author._id) {
    // If it's a populated user object, use the _id
    commentAuthorIdStr = comment.author._id.toString();
  } else {
    // If it's an ObjectId, convert to string
    commentAuthorIdStr = comment.author.toString();
  }

  // Check if the user is allowed to delete the comment (either the comment's author or an admin)
  if (
    commentAuthorIdStr !== req.user.id.toString() &&
    !req.user.role.includes("admin")
  ) {
    return next(
      new AppError("You do not have permission to delete this comment", 403)
    );
  }

  // Remove the comment from the post's comments array
  post.comments.pull(commentId);
  post.markModified('comments');
  await post.save(); // Save the post after removal

  res.status(204).json({ status: "success", data: null }); // Return success response
});

async function deleteS3Media(media) {
  if (!media || !Array.isArray(media)) return;
  for (const url of media) {
    const key = url.split('.amazonaws.com/')[1];
    if (key) {
      try {
        await s3Client.send(new DeleteObjectCommand({
          Bucket: process.env.AWS_S3_BUCKET_NAME,
          Key: key,
        }));
      } catch (err) {
        logger.error('Failed to delete S3 media', { key, err });
      }
    }
  }
}



async function notifyAdmin(message, data) {
  try {
    await Notification.create({
      user: process.env.ADMIN_USER_ID,
      type: 'system',
      message,
      data,
    });
  } catch (err) {
    logger.error('Failed to notify admin', { message, data, err });
  }
}
