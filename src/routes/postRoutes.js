import express from 'express';
import { body, param, query } from 'express-validator';
import validateRequest from '../middleware/validateRequest.js';
import {
    getPostFeed, getPost,  getUserPosts, createPost, updatePost, deletePost, likePost, unlikePost, addComment, deleteComment
} from '../controllers/postController.js';
import { protect } from '../controllers/authController.js'; // Middleware to protect routes that require authentication

const router = express.Router();

/**
 * ================================
 *          PROTECT ROUTES
 * ================================
 * All routes below this middleware require the user to be logged in.
 */
router.use(protect); // Protect all routes below this middleware (user must be logged in)


/**
 * ================================
 *        POST FEED & CREATION ROUTES
 * ================================
 * These routes allow users to view the post feed and create new posts.
 */

// Route to get the feed of all posts with query parameter validation (page, limit, sort, location-based filters)
router.route('/')
    .get([ 
        query('page').optional().isInt({ min: 1 }).toInt(),
        query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
        query('sort').optional().isIn(['recents', 'trending', 'near_me']),
        query('lat').optional().isFloat(),
        query('lng').optional().isFloat(),
        query('distance').optional().isFloat({ min: 0.1 }),
    ], validateRequest, getPostFeed) // Basic checks, controller handles complex logic like requiring lat/lng
    .post([ // Validation for creating a post
        body('content').notEmpty().withMessage('Post content cannot be empty').trim().escape().isLength({ max: 2000 }),
        body('media').optional().isArray(),
        body('media.*').optional().isURL().withMessage('Invalid media URL format'), // Basic URL check
        body('tags').optional().isArray(),
        body('tags.*').optional().isString().trim().escape().toLowerCase(),
        body('location').optional().isObject(),
        body('location.coordinates').optional().isArray({ min: 2, max: 2 }).withMessage('Coordinates must be an array of [longitude, latitude]'),
        body('location.coordinates.*').optional().isFloat(),
        body('location.address').optional().trim().escape(),
    ], validateRequest, createPost);


/**
 * ================================
 *        INDIVIDUAL POST ROUTES
 * ================================
 * These routes allow users to view, update, or delete individual posts.
 * Permissions for updating or deleting posts should be handled in the controller (e.g., by checking if the user is the post author).
 */

// Route to get a specific post by its ID
router.route('/:id')
  .get(
    param('id').isMongoId().withMessage('Invalid Post ID format'),
    validateRequest,
    getPost
  )
  .patch( // Permissions checked in controller
    param('id').isMongoId().withMessage('Invalid Post ID format'),
    [ // Validation for updating post
      body('content').optional().trim().escape().isLength({ max: 2000 }),
      body('media').optional().isArray(),
      body('media.*').optional().isURL(),
      body('tags').optional().isArray(),
      body('tags.*').optional().isString().trim().escape().toLowerCase(),
    ],
    validateRequest,
    updatePost
  )
  .delete( // Permissions checked in controller
    param('id').isMongoId().withMessage('Invalid Post ID format'),
    validateRequest,
    deletePost
  );

/**
 * ================================
 *         USER POSTS ROUTE
 * ================================
 * This route retrieves all posts associated with a specific user.
 * Useful for displaying a user's posts on their profile or dashboard.
 *
 * Route: GET /api/v1/posts/user/:userId
 * Middleware:
 * - protect: Ensures the user is authenticated (can be removed if user profiles are public).
 * - param('userId'): Validates that the user ID is a valid MongoDB ObjectId.
 * - query('page') and query('limit'): Support pagination of results.
 *
 * The actual fetching logic and any permission handling (e.g., if posts should only be visible to certain users)
 * should be managed inside the getUserPosts controller.
 */
router.get('/user/:userId', [ // Example path: /api/v1/posts/user/:userId
    protect, // Or make it public if user profiles are public
    param('userId').isMongoId().withMessage('Invalid user ID format'),
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
], validateRequest, getUserPosts);


/**
 * ================================
 *        LIKE/UNLIKE POST ROUTES
 * ================================
 * These routes allow users to like or unlike a post.
 */

// Route to like a post
router.patch('/:id/like', [
    param('id').isMongoId().withMessage('Invalid Post ID format'),
], validateRequest, likePost);

// Route to unlike a post
router.patch('/:id/unlike', [
    param('id').isMongoId().withMessage('Invalid Post ID format'),
], validateRequest, unlikePost);


/**
 * ================================
 *           COMMENT ROUTES
 * ================================
 * These routes allow users to add or delete comments on posts.
 * Permissions for deleting comments should be handled in the controller (e.g., by checking if the user is the comment author).
 */

// Route to add a comment to a specific post
router.post('/:id/comments', [
    param('id').isMongoId().withMessage('Invalid Post ID format'),
    body('text').notEmpty().withMessage('Comment text cannot be empty').trim().escape().isLength({ max: 1000 }),
], validateRequest, addComment);

// Route to delete a specific comment from a post
router.delete('/:postId/comments/:commentId', [ // Permissions checked in controller
    param('postId').isMongoId().withMessage('Invalid Post ID format'),
    param('commentId').isMongoId().withMessage('Invalid Comment ID format'),
], validateRequest, deleteComment);

export default router;
