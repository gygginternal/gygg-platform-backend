// Importing required modules
import Post from '../models/Post.js';
import AppError from '../utils/AppError.js';
import catchAsync from '../utils/catchAsync.js';
import mongoose from 'mongoose';

// Utility function to check if the user is the owner of the post or has admin privileges
const checkOwnershipOrAdmin = (resourceUserId, requestingUser) => {
  if (resourceUserId.toString() !== requestingUser.id && !requestingUser.role.includes('admin')) {
    throw new AppError('You do not have permission to perform this action', 403);
  }
  return true;  // Return true if the user is authorized
};

// Route handler to get the feed of posts, with optional sorting, pagination, and geolocation-based filtering
export const getPostFeed = catchAsync(async (req, res, next) => {
  const { sort, lat, lng, distance, page, limit } = req.query;
  let query = Post.find();

  // Handle sorting based on query parameter
  if (sort === 'trending') {
    // Sort by likeCount and createdAt for trending posts
    query = query.sort('-likeCount -createdAt');
  } else if (sort === 'near_me') {
    // If 'near me' sorting is selected, handle geospatial filtering
    if (!lat || !lng) {
      return next(new AppError('Please provide latitude (lat) and longitude (lng) for "near me" sorting.', 400));
    }
    const maxDistance = (distance * 1 || 10) * 1000;  // Default max distance is 10km in meters
    query = query.where('location').near({
      center: { type: 'Point', coordinates: [parseFloat(lng), parseFloat(lat)] },
      maxDistance: maxDistance,
      spherical: true
    });
    query = query.sort('-createdAt');  // Sort nearby results by recency
  } else {
    query = query.sort('-createdAt');  // Default sorting by most recent
  }

  // Handle pagination
  const pageNum = page * 1 || 1;
  const limitNum = limit * 1 || 20;  // Default limit is 20 posts per page
  const skip = (pageNum - 1) * limitNum;
  query = query.skip(skip).limit(limitNum).select('-__v');  // Exclude __v field from the response

  // Execute the query and fetch posts
  const posts = await query;

  // Return the response with posts data
  res.status(200).json({ status: 'success', results: posts.length, data: { posts } });
});

// Route handler to get a single post by ID
export const getPost = catchAsync(async (req, res, next) => {
  const post = await Post.findById(req.params.id);  // Find post by ID
  if (!post) {
    return next(new AppError('No post found with that ID', 404));  // Handle if post not found
  }
  res.status(200).json({ status: 'success', data: { post } });  // Return post data
});

// Route handler to create a new post
export const createPost = catchAsync(async (req, res, next) => {
  const { content, media, tags, location } = req.body;

  // Validate location if provided
  let locationData;
  if (location && location.coordinates && Array.isArray(location.coordinates) && location.coordinates.length === 2) {
    locationData = {
      type: 'Point',
      coordinates: [parseFloat(location.coordinates[0]), parseFloat(location.coordinates[1])],  // Ensure correct coordinate order
      address: location.address  // Optional address
    };
  }

  // Create a new post with the provided data
  const newPost = await Post.create({
    author: req.user.id,
    content,
    media,
    tags,
    location: locationData
  });

  // Return the created post data
  res.status(201).json({ status: 'success', data: { post: newPost } });
});

// Route handler to update an existing post
export const updatePost = catchAsync(async (req, res, next) => {
  const post = await Post.findById(req.params.id);  // Find the post by ID
  if (!post) {
    return next(new AppError('No post found with that ID', 404));  // Handle if post not found
  }

  // Check ownership or admin role before allowing update
  checkOwnershipOrAdmin(post.author, req.user);

  // Allowed fields for update
  const allowedUpdates = {};
  ['content', 'media', 'tags'].forEach(field => {
    if (req.body[field] !== undefined) allowedUpdates[field] = req.body[field];
  });

  // Update the post with allowed fields
  const updatedPost = await Post.findByIdAndUpdate(req.params.id, allowedUpdates, { new: true, runValidators: true });

  // Return updated post data
  res.status(200).json({ status: 'success', data: { post: updatedPost } });
});

// Route handler to delete a post
export const deletePost = catchAsync(async (req, res, next) => {
  const post = await Post.findById(req.params.id);  // Find the post by ID
  if (!post) {
    return next(new AppError('No post found with that ID', 404));  // Handle if post not found
  }

  // Check ownership or admin role before allowing deletion
  checkOwnershipOrAdmin(post.author, req.user);

  // Delete the post from the database
  await Post.findByIdAndDelete(req.params.id);

  // Return success response
  res.status(204).json({ status: 'success', data: null });
});

// Route handler to like a post
export const likePost = catchAsync(async (req, res, next) => {
  // Update the post's likes array to include the current user
  const post = await Post.findByIdAndUpdate(
    req.params.id,
    { $addToSet: { likes: req.user.id } },  // Add user ID to likes array if not already present
    { new: true }
  );

  if (!post) {
    return next(new AppError('No post found with that ID', 404));  // Handle if post not found
  }

  // Trigger save to update likeCount via pre-save hook
  await post.save({ validateBeforeSave: false });

  // Return success response
  res.status(200).json({ status: 'success', message: 'Post liked', data: { likeCount: post.likeCount } });
});

// Route handler to unlike a post
export const unlikePost = catchAsync(async (req, res, next) => {
  // Update the post's likes array to remove the current user
  const post = await Post.findByIdAndUpdate(
    req.params.id,
    { $pull: { likes: req.user.id } },  // Remove user ID from likes array
    { new: true }
  );

  if (!post) {
    return next(new AppError('No post found with that ID', 404));  // Handle if post not found
  }

  // Trigger save to update likeCount via pre-save hook
  await post.save({ validateBeforeSave: false });

  // Return success response
  res.status(200).json({ status: 'success', message: 'Post unliked', data: { likeCount: post.likeCount } });
});

// Route handler to add a comment to a post
export const addComment = catchAsync(async (req, res, next) => {
  const { text } = req.body;
  if (!text || text.trim() === '') {
    return next(new AppError('Comment text cannot be empty', 400));  // Validate that the comment is not empty
  }

  // Create a comment object with user and text
  const comment = { user: req.user.id, text: text.trim() };

  // Update the post with the new comment
  const post = await Post.findByIdAndUpdate(
    req.params.id,
    { $push: { comments: comment } },
    { new: true, runValidators: true }
  ).populate('comments.user', 'firstName lastName profileImage');  // Populate user data for the comment

  if (!post) {
    return next(new AppError('No post found with that ID', 404));  // Handle if post not found
  }

  // Trigger save to update commentCount via pre-save hook
  await post.save({ validateBeforeSave: false });

  // Return the updated post with the new comment
  res.status(201).json({ status: 'success', data: { post } });
});

// Route handler to delete a comment from a post
export const deleteComment = catchAsync(async (req, res, next) => {
  const { postId, commentId } = req.params;
  const post = await Post.findById(postId);  // Find the post by ID

  if (!post) {
    return next(new AppError('Post not found', 404));  // Handle if post not found
  }

  // Find the comment by ID
  const comment = post.comments.id(commentId);
  if (!comment) {
    return next(new AppError('Comment not found', 404));  // Handle if comment not found
  }

  // Check if the user is allowed to delete the comment (either the comment's author or an admin)
  if (comment.user.toString() !== req.user.id && !req.user.role.includes('admin')) {
    return next(new AppError('You do not have permission to delete this comment', 403));
  }

  // Remove the comment from the post's comments array
  comment.remove();
  await post.save();  // Save the post after removal

  res.status(204).json({ status: 'success', data: null });  // Return success response
});
