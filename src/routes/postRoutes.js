import express from 'express';
import {
  getPostFeed,
  getPost,
  createPost,
  updatePost,
  deletePost,
  likePost,
  unlikePost,
  addComment,
  deleteComment,
} from '../controllers/postController.js';
import { protect } from '../controllers/authController.js';

const router = express.Router();

// All post routes require user to be logged in
router.use(protect);

// --- Post Feed & CRUD ---
router
    .route('/')
    .get(getPostFeed) // Get the main feed
    .post(createPost); // Any logged-in user can create a post

router
    .route('/:id')
    .get(getPost) // Get a single post
    .patch(updatePost) // Logic in controller checks ownership/admin
    .delete(deletePost); // Logic in controller checks ownership/admin

// --- Likes ---
router.patch('/:id/like', likePost);
router.patch('/:id/unlike', unlikePost);

// --- Comments ---
router.post('/:id/comments', addComment); // Add comment to post with :id
router.delete('/:postId/comments/:commentId', deleteComment); // Delete specific comment

export default router;