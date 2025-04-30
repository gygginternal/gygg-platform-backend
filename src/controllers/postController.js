import Post from '../models/Post.js';
import AppError from '../utils/AppError.js';
import catchAsync from '../utils/catchAsync.js';
// Optional: APIFeatures for advanced filtering/sorting/pagination
// import APIFeatures from '../utils/apiFeatures.js';

// --- Utility function to check ownership or admin role ---
const checkOwnershipOrAdmin = (resourceUserId, requestingUser) => {
  if (resourceUserId.toString() !== requestingUser.id && !requestingUser.role.includes('admin')) {
    throw new AppError('You do not have permission to perform this action', 403);
  }
  return true;
};

// --- Post Route Handlers ---

// Get Feed (All Posts with Sorting)
export const getPostFeed = catchAsync(async (req, res, next) => {
  const { sort, lat, lng, distance, page, limit } = req.query;
  let query = Post.find();

  // 1. Sorting
  if (sort === 'trending') {
    // Basic Trending: Sort by likeCount descending (improve later)
    query = query.sort('-likeCount -createdAt');
  } else if (sort === 'near_me') {
    // Geospatial Query for 'Near Me'
    if (!lat || !lng) {
      return next(new AppError('Please provide your latitude (lat) and longitude (lng) for "near me" sorting.', 400));
    }
    const maxDistance = (distance * 1 || 10) * 1000; // Default 10km, convert to meters
    query = query.find({
      location: {
        $nearSphere: {
          $geometry: {
            type: 'Point',
            coordinates: [parseFloat(lng), parseFloat(lat)] // Longitude first!
          },
          $maxDistance: maxDistance
        }
      }
    });
    // Geospatial queries don't always mix well with standard sort, but we can try adding secondary sort
    query = query.sort('-createdAt'); // Sort nearby results by recent

  } else { // Default: 'recents'
    query = query.sort('-createdAt');
  }

  // 2. Pagination (Basic)
  const pageNum = page * 1 || 1;
  const limitNum = limit * 1 || 20; // Default limit for posts
  const skip = (pageNum - 1) * limitNum;
  query = query.skip(skip).limit(limitNum);

  // 3. Field Limiting (Optional)
  query = query.select('-__v'); // Exclude __v

  // 4. Execute Query (Populate handled by model middleware)
  const posts = await query;

  res.status(200).json({
    status: 'success',
    results: posts.length,
    data: {
      posts,
    },
  });
});


// Get Single Post
export const getPost = catchAsync(async (req, res, next) => {
  const post = await Post.findById(req.params.id).populate('comments.user', 'firstName lastName profileImage'); // Ensure comment user is populated

  if (!post) {
    return next(new AppError('No post found with that ID', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      post,
    },
  });
});

// Create Post
export const createPost = catchAsync(async (req, res, next) => {
  const { content, media, tags, relatedGig, location } = req.body; // location expected as { coordinates: [lng, lat], address: 'optional string' }
  const author = req.user.id;

  // Validate location format if provided
  let locationData = undefined;
  if (location && location.coordinates && Array.isArray(location.coordinates) && location.coordinates.length === 2) {
      locationData = {
          type: 'Point',
          coordinates: [parseFloat(location.coordinates[0]), parseFloat(location.coordinates[1])], // Ensure numbers
          address: location.address || undefined
      }
  }

  const newPost = await Post.create({
    author,
    content,
    media, // Assuming media is an array of { url: '...', type: 'image/video' }
    tags,
    relatedGig, // Should be a valid Gig ObjectId if provided
    location: locationData
  });

  res.status(201).json({
    status: 'success',
    data: {
      post: newPost,
    },
  });
});

// Update Post (Author or Admin Only)
export const updatePost = catchAsync(async (req, res, next) => {
  const post = await Post.findById(req.params.id);

  if (!post) {
    return next(new AppError('No post found with that ID', 404));
  }

  checkOwnershipOrAdmin(post.author, req.user); // Pass the author ID

  // Filter allowed fields
  const allowedUpdates = {};
  const fieldsToUpdate = ['content', 'media', 'tags', 'relatedGig']; // Location update might need care
  fieldsToUpdate.forEach(field => {
    if (req.body[field] !== undefined) {
      allowedUpdates[field] = req.body[field];
    }
  });

  const updatedPost = await Post.findByIdAndUpdate(req.params.id, allowedUpdates, {
    new: true,
    runValidators: true,
  });

  res.status(200).json({
    status: 'success',
    data: {
      post: updatedPost,
    },
  });
});

// Delete Post (Author or Admin Only)
export const deletePost = catchAsync(async (req, res, next) => {
  const post = await Post.findById(req.params.id);

  if (!post) {
    return next(new AppError('No post found with that ID', 404));
  }

  checkOwnershipOrAdmin(post.author, req.user); // Pass the author ID

  await Post.findByIdAndDelete(req.params.id);

  res.status(204).json({
    status: 'success',
    data: null,
  });
});

// --- Like / Unlike Post ---
export const likePost = catchAsync(async (req, res, next) => {
  const postId = req.params.id;
  const userId = req.user.id;

  // Use $addToSet to prevent duplicate likes and update likeCount
  const updatedPost = await Post.findByIdAndUpdate(
    postId,
    {
      $addToSet: { likes: userId }, // Add user ID to likes array only if not already present
      // We'll rely on the pre-save hook to update likeCount
    },
    { new: true } // Return the updated document
  );

  if (!updatedPost) {
    return next(new AppError('No post found with that ID', 404));
  }
  // Manually trigger save to run the pre-save hook for likeCount update
  await updatedPost.save({ validateBeforeSave: false });


  res.status(200).json({
    status: 'success',
    message: 'Post liked',
    data: {
      likes: updatedPost.likes, // Send back the updated likes array
      likeCount: updatedPost.likeCount
    },
  });
});

export const unlikePost = catchAsync(async (req, res, next) => {
  const postId = req.params.id;
  const userId = req.user.id;

  // Use $pull to remove the user ID and update likeCount
  const updatedPost = await Post.findByIdAndUpdate(
    postId,
    {
      $pull: { likes: userId }, // Remove user ID from likes array
      // Rely on pre-save hook for likeCount
    },
    { new: true }
  );

  if (!updatedPost) {
    return next(new AppError('No post found with that ID', 404));
  }
  // Manually trigger save to run the pre-save hook for likeCount update
  await updatedPost.save({ validateBeforeSave: false });


  res.status(200).json({
    status: 'success',
    message: 'Post unliked',
     data: {
      likes: updatedPost.likes,
      likeCount: updatedPost.likeCount
    },
  });
});


// --- Add Comment ---
export const addComment = catchAsync(async (req, res, next) => {
  const postId = req.params.id;
  const userId = req.user.id;
  const { text } = req.body;

  if (!text || text.trim() === '') {
      return next(new AppError('Comment text cannot be empty', 400));
  }

  const comment = {
      user: userId,
      text: text.trim(),
      // createdAt is handled by default in schema
  };

  const updatedPost = await Post.findByIdAndUpdate(
      postId,
      { $push: { comments: comment } }, // Add new comment to the array
      { new: true, runValidators: true } // Return updated post, run validators
  ).populate('comments.user', 'firstName lastName profileImage'); // Populate user in the new comment

  if (!updatedPost) {
      return next(new AppError('No post found with that ID', 404));
  }
   // Manually trigger save to run the pre-save hook for commentCount update
   await updatedPost.save({ validateBeforeSave: false });

  res.status(201).json({
      status: 'success',
      data: {
          post: updatedPost // Return the post with the new comment populated
      }
  });
});

// --- Delete Comment (Comment Author, Post Author, or Admin) ---
export const deleteComment = catchAsync(async (req, res, next) => {
  const { postId, commentId } = req.params;
  const userId = req.user.id;

  const post = await Post.findById(postId);
  if (!post) {
    return next(new AppError('Post not found', 404));
  }

  // Find the comment within the post's comments array
  const comment = post.comments.id(commentId); // Mongoose subdocument ID selector
  if (!comment) {
    return next(new AppError('Comment not found', 404));
  }

  // Check permissions: Comment author OR Post author OR Admin
  const isCommentAuthor = comment.user.toString() === userId;
  const isPostAuthor = post.author.toString() === userId;
  const isAdmin = req.user.role.includes('admin');

  if (!isCommentAuthor && !isPostAuthor && !isAdmin) {
    return next(new AppError('You do not have permission to delete this comment', 403));
  }

  // Remove the comment using $pull
   const updatedPost = await Post.findByIdAndUpdate(
      postId,
      { $pull: { comments: { _id: commentId } } },
      { new: true }
  );

   // Manually trigger save to run the pre-save hook for commentCount update
   await updatedPost.save({ validateBeforeSave: false });


  res.status(200).json({ // 200 OK or 204 No Content are both acceptable
    status: 'success',
    message: 'Comment deleted',
     data: {
        commentCount: updatedPost.commentCount
     }
  });
});