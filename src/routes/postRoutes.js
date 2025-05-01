import express from 'express';
import {
  getPostFeed,    // Function to retrieve the feed of posts
  getPost,        // Function to get a specific post by its ID
  createPost,     // Function to create a new post
  updatePost,     // Function to update an existing post
  deletePost,     // Function to delete a post
  likePost,       // Function to like a post
  unlikePost,     // Function to unlike a post
  addComment,     // Function to add a comment to a post
  deleteComment,  // Function to delete a comment from a post
} from '../controllers/postController.js';
import { protect } from '../controllers/authController.js'; // Middleware to protect routes that require authentication

const router = express.Router();

/**
 * --- Protect Routes ---
 * All routes below this middleware require the user to be logged in.
 */
router.use(protect); // Protect all routes below this middleware (user must be logged in)

/**
 * --- Post Feed & Creation Routes ---
 * These routes allow users to view the post feed and create new posts.
 */

// Route to get the feed of all posts
router.route('/').get(getPostFeed)
// Route to create a new post
  .post(createPost);


/**
 * --- Individual Post Routes ---
 * These routes allow users to view, update, or delete individual posts.
 * Permissions for updating or deleting posts should be handled in the controller (e.g., by checking if the user is the post author).
 */

// Route to get a specific post by its ID
router.route('/:id')
  .get(getPost)         // Get the post by ID
  .patch(updatePost)    // Update the post (permissions checked in the controller)
  .delete(deletePost);  // Delete the post (permissions checked in the controller)


/**
 * --- Like/Unlike Post Routes ---
 * These routes allow users to like or unlike a post.
 */

// Route to like a post
router.patch('/:id/like', likePost);

// Route to unlike a post
router.patch('/:id/unlike', unlikePost);


/**
 * --- Comment Routes ---
 * These routes allow users to add or delete comments on posts.
 * Permissions for deleting comments should be handled in the controller (e.g., by checking if the user is the comment author).
 */

// Route to add a comment to a specific post
router.post('/:id/comments', addComment);

// Route to delete a specific comment from a post
router.delete('/:postId/comments/:commentId', deleteComment); // Permissions checked in the controller

export default router;
