import mongoose from 'mongoose';
import { testUsers, testPost, createToken, request, app } from './setup.js';
import User from '../src/models/User.js';
import Post from '../src/models/Post.js';

describe('Post API', () => {
  let user, userToken, post;

  beforeEach(async () => {
    await User.deleteMany({});
    await Post.deleteMany({});

    // Create test user
    user = await User.create(testUsers.provider);
    userToken = createToken(user._id);

    // Create test post owned by the user
    post = await Post.create({
      content: 'Test post content for testing',
      author: user._id
    });
  });

  describe('GET /api/v1/posts', () => {
    it('should get all posts with authentication', async () => {
      const res = await request(app)
        .get('/api/v1/posts')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
      expect(Array.isArray(res.body.data.posts)).toBe(true);
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app).get('/api/v1/posts');
      expect(res.statusCode).toBe(401);
    });

    it('should support pagination', async () => {
      const res = await request(app)
        .get('/api/v1/posts?page=1&limit=10')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
    });

    it('should support sorting', async () => {
      const res = await request(app)
        .get('/api/v1/posts?sort=recents')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
    });

    it('should support location-based filtering', async () => {
      const res = await request(app)
        .get('/api/v1/posts?lat=40.7128&lng=-74.0060&distance=10')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
    });
  });

  describe('POST /api/v1/posts', () => {
    it('should create a new post successfully', async () => {
      const newPost = {
        content: 'This is a new test post content'
      };

      const res = await request(app)
        .post('/api/v1/posts')
        .set('Authorization', `Bearer ${userToken}`)
        .send(newPost);

      expect(res.statusCode).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data.post).toHaveProperty('content', newPost.content);
    });

    it('should create a post with image upload', async () => {
      const res = await request(app)
        .post('/api/v1/posts')
        .set('Authorization', `Bearer ${userToken}`)
        .field('content', 'Post with image')
        .attach('postImage', Buffer.from('fake image data'), 'test.jpg');

      expect(res.statusCode).toBe(201);
      expect(res.body.status).toBe('success');
    });

    it('should return 400 for missing content', async () => {
      const res = await request(app)
        .post('/api/v1/posts')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(400);
      expect(res.body.status).toBe('fail');
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app)
        .post('/api/v1/posts')
        .send({ content: 'Test post' });

      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /api/v1/posts/:id', () => {
    it('should get a specific post', async () => {
      const res = await request(app)
        .get(`/api/v1/posts/${post._id}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.post).toHaveProperty('_id', post._id.toString());
    });

    it('should return 404 for non-existent post', async () => {
      const fakeId = '507f1f77bcf86cd799439011';
      const res = await request(app)
        .get(`/api/v1/posts/${fakeId}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(404);
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app).get(`/api/v1/posts/${post._id}`);
      expect(res.statusCode).toBe(401);
    });
  });

  describe('PATCH /api/v1/posts/:id', () => {
    it('should update a post successfully', async () => {
      const updateData = {
        content: 'Updated post content'
      };

      const res = await request(app)
        .patch(`/api/v1/posts/${post._id}`)
        .set('Authorization', `Bearer ${userToken}`)
        .send(updateData);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.post).toHaveProperty('content', updateData.content);
    });

    it('should return 404 for non-existent post', async () => {
      const fakeId = '507f1f77bcf86cd799439011';
      const res = await request(app)
        .patch(`/api/v1/posts/${fakeId}`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ content: 'Updated content' });

      expect(res.statusCode).toBe(404);
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app)
        .patch(`/api/v1/posts/${post._id}`)
        .send({ content: 'Updated content' });

      expect(res.statusCode).toBe(401);
    });

    it('should return 403 when trying to update another user\'s post', async () => {
      // Create another user and post
      const otherUser = await User.create(testUsers.tasker);
      const otherPost = await Post.create({
        content: 'Another user\'s post',
        author: otherUser._id
      });

      const res = await request(app)
        .patch(`/api/v1/posts/${otherPost._id}`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ content: 'Trying to update another user\'s post' });

      expect(res.statusCode).toBe(403);
    });
  });

  describe('DELETE /api/v1/posts/:id', () => {
    it('should delete a post successfully', async () => {
      const res = await request(app)
        .delete(`/api/v1/posts/${post._id}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(204);
    });

    it('should return 404 for non-existent post', async () => {
      const fakeId = '507f1f77bcf86cd799439011';
      const res = await request(app)
        .delete(`/api/v1/posts/${fakeId}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(404);
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app).delete(`/api/v1/posts/${post._id}`);
      expect(res.statusCode).toBe(401);
    });

    it('should return 403 when trying to delete another user\'s post', async () => {
      // Create another user and post
      const otherUser = await User.create(testUsers.tasker);
      const otherPost = await Post.create({
        content: 'Another user\'s post',
        author: otherUser._id
      });

      const res = await request(app)
        .delete(`/api/v1/posts/${otherPost._id}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(403);
    });
  });

  describe('GET /api/v1/posts/user/:userId', () => {
    it('should get posts by user ID', async () => {
      const res = await request(app)
        .get(`/api/v1/posts/user/${user._id}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
      expect(Array.isArray(res.body.data.posts)).toBe(true);
    });

    it('should support pagination for user posts', async () => {
      const res = await request(app)
        .get(`/api/v1/posts/user/${user._id}?page=1&limit=10`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app).get(`/api/v1/posts/user/${user._id}`);
      expect(res.statusCode).toBe(401);
    });
  });

  describe('PATCH /api/v1/posts/:id/like', () => {
    it('should like a post successfully', async () => {
      const res = await request(app)
        .patch(`/api/v1/posts/${post._id}/like`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
    });

    it('should return 404 for non-existent post', async () => {
      const fakeId = '507f1f77bcf86cd799439011';
      const res = await request(app)
        .patch(`/api/v1/posts/${fakeId}/like`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(404);
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app).patch(`/api/v1/posts/${post._id}/like`);
      expect(res.statusCode).toBe(401);
    });
  });

  describe('PATCH /api/v1/posts/:id/unlike', () => {
    it('should unlike a post successfully', async () => {
      // First like the post
      await request(app)
        .patch(`/api/v1/posts/${post._id}/like`)
        .set('Authorization', `Bearer ${userToken}`);

      // Then unlike it
      const res = await request(app)
        .patch(`/api/v1/posts/${post._id}/unlike`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
    });

    it('should return 404 for non-existent post', async () => {
      const fakeId = '507f1f77bcf86cd799439011';
      const res = await request(app)
        .patch(`/api/v1/posts/${fakeId}/unlike`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(404);
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app).patch(`/api/v1/posts/${post._id}/unlike`);
      expect(res.statusCode).toBe(401);
    });
  });

  describe('POST /api/v1/posts/:id/comments', () => {
    it('should add a comment to a post successfully', async () => {
      const commentData = {
        text: 'This is a test comment'
      };

      const res = await request(app)
        .post(`/api/v1/posts/${post._id}/comments`)
        .set('Authorization', `Bearer ${userToken}`)
        .send(commentData);

      expect(res.statusCode).toBe(201);
      expect(res.body.status).toBe('success');
    });

    it('should return 400 for missing comment text', async () => {
      const res = await request(app)
        .post(`/api/v1/posts/${post._id}/comments`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({});

      expect(res.statusCode).toBe(400);
      expect(res.body.status).toBe('fail');
    });

    it('should return 404 for non-existent post', async () => {
      const fakeId = '507f1f77bcf86cd799439011';
      const res = await request(app)
        .post(`/api/v1/posts/${fakeId}/comments`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ text: 'Test comment' });

      expect(res.statusCode).toBe(404);
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app)
        .post(`/api/v1/posts/${post._id}/comments`)
        .send({ text: 'Test comment' });

      expect(res.statusCode).toBe(401);
    });
  });

  describe('DELETE /api/v1/posts/:postId/comments/:commentId', () => {
    it('should delete a comment successfully', async () => {
      // First add a comment as the user
      const commentRes = await request(app)
        .post(`/api/v1/posts/${post._id}/comments`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ text: 'Comment to delete' });

      expect(commentRes.statusCode).toBe(201);
      
      // Get the comment ID from the last comment in the post
      const commentId = commentRes.body.data.post.comments[commentRes.body.data.post.comments.length - 1]._id;

      // Then delete it as the same user
      const res = await request(app)
        .delete(`/api/v1/posts/${post._id}/comments/${commentId}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(204);
    });

    it('should return 404 for non-existent post', async () => {
      const fakePostId = '507f1f77bcf86cd799439011';
      const commentId = '507f1f77bcf86cd799439012';
      const res = await request(app)
        .delete(`/api/v1/posts/${fakePostId}/comments/${commentId}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(404);
    });

    it('should return 401 without authentication', async () => {
      // First create a comment to get a valid comment ID
      const commentRes = await request(app)
        .post(`/api/v1/posts/${post._id}/comments`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ text: 'Comment to delete' });
      
      const commentId = commentRes.body.data.post.comments[commentRes.body.data.post.comments.length - 1]._id;
      
      const res = await request(app).delete(`/api/v1/posts/${post._id}/comments/${commentId}`);
      expect(res.statusCode).toBe(401);
    });
  });
}); 