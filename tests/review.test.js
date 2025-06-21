import mongoose from 'mongoose';
import { testUsers, testGig, createToken, request, app } from './setup.js';
import User from '../src/models/User.js';
import Review from '../src/models/Review.js';
import Contract from '../src/models/Contract.js';
import { Gig } from '../src/models/Gig.js';

describe('Review API', () => {
  let provider, tasker, providerToken, taskerToken, review, gig, contract;

  beforeEach(async () => {
    await User.deleteMany({});
    await Gig.deleteMany({});
    await Contract.deleteMany({});
    await Review.deleteMany({});
    
    provider = await User.create(testUsers.provider);
    tasker = await User.create(testUsers.tasker);
    
    providerToken = createToken(provider._id);
    taskerToken = createToken(tasker._id);

    gig = await Gig.create({
      ...testGig,
      postedBy: provider._id
    });

    contract = await Contract.create({
      gig: gig._id,
      provider: provider._id,
      tasker: tasker._id,
      status: 'completed',
      amount: 50.00,
      agreedCost: 50.00
    });

    review = await Review.create({
      contract: contract._id,
      reviewer: provider._id,
      reviewee: tasker._id,
      rating: 5,
      comment: 'Great work!',
      gig: gig._id
    });
  });

  describe('GET /api/v1/reviews', () => {
    it('should get all reviews with authentication', async () => {
      const res = await request(app)
        .get('/api/v1/reviews')
        .set('Authorization', `Bearer ${providerToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
      expect(Array.isArray(res.body.data.reviews)).toBe(true);
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app).get('/api/v1/reviews');
      expect(res.statusCode).toBe(401);
    });

    it('should filter by gig ID', async () => {
      const res = await request(app)
        .get('/api/v1/reviews?gigId=' + gig._id.toString())
        .set('Authorization', `Bearer ${providerToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
    });

    it('should filter by tasker ID', async () => {
      const res = await request(app)
        .get('/api/v1/reviews?taskerId=' + tasker._id.toString())
        .set('Authorization', `Bearer ${providerToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
    });

    it('should filter by provider ID', async () => {
      const res = await request(app)
        .get('/api/v1/reviews?providerId=' + provider._id.toString())
        .set('Authorization', `Bearer ${providerToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
    });

    it('should support pagination', async () => {
      const res = await request(app)
        .get('/api/v1/reviews?page=1&limit=10')
        .set('Authorization', `Bearer ${providerToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
    });
  });

  describe('POST /api/v1/reviews', () => {
    it('should create a new review successfully', async () => {
      // Create a unique gig and contract for this test
      const uniqueGig = await Gig.create({
        ...testGig,
        postedBy: provider._id,
        title: 'Unique Gig for Review Creation'
      });
      const uniqueContract = await Contract.create({
        gig: uniqueGig._id,
        provider: provider._id,
        tasker: tasker._id,
        status: 'completed',
        amount: 100.00,
        agreedCost: 100.00
      });
      const res = await request(app)
        .post('/api/v1/reviews')
        .set('Authorization', `Bearer ${providerToken}`)
        .send({
          contract: uniqueContract._id,
          gig: uniqueGig._id,
          reviewer: provider._id,
          reviewee: tasker._id,
          rating: 5,
          comment: 'Excellent!'
        });
      expect(res.statusCode).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data.review).toHaveProperty('comment', 'Excellent!');
    });

    it('should return 400 for missing required fields', async () => {
      const res = await request(app)
        .post('/api/v1/reviews')
        .set('Authorization', `Bearer ${providerToken}`)
        .send({ rating: 5 });

      expect(res.statusCode).toBe(400);
      expect(res.body.status).toBe('fail');
    });

    it('should return 400 for invalid rating', async () => {
      const res = await request(app)
        .post('/api/v1/reviews')
        .set('Authorization', `Bearer ${providerToken}`)
        .send({
          contract: contract._id,
          rating: 6,
          comment: 'Test comment'
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.status).toBe('fail');
    });

    it('should return 403 for non-provider users', async () => {
      const res = await request(app)
        .post('/api/v1/reviews')
        .set('Authorization', `Bearer ${taskerToken}`)
        .send({
          contract: contract._id,
          rating: 5,
          comment: 'Test comment'
        });

      expect(res.statusCode).toBe(403);
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app)
        .post('/api/v1/reviews')
        .send({
          contract: contract._id,
          rating: 5,
          comment: 'Test comment'
        });

      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /api/v1/reviews/:id', () => {
    it('should get a specific review', async () => {
      const res = await request(app)
        .get(`/api/v1/reviews/${review._id}`)
        .set('Authorization', `Bearer ${providerToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.review).toHaveProperty('_id', review._id.toString());
    });

    it('should return 404 for non-existent review', async () => {
      const fakeId = '507f1f77bcf86cd799439011';
      const res = await request(app)
        .get(`/api/v1/reviews/${fakeId}`)
        .set('Authorization', `Bearer ${providerToken}`);

      expect(res.statusCode).toBe(404);
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app).get(`/api/v1/reviews/${review._id}`);
      expect(res.statusCode).toBe(401);
    });
  });

  describe('PATCH /api/v1/reviews/:id', () => {
    it('should update a review successfully', async () => {
      const updateData = {
        rating: 4,
        comment: 'Updated comment'
      };

      const res = await request(app)
        .patch(`/api/v1/reviews/${review._id}`)
        .set('Authorization', `Bearer ${providerToken}`)
        .send(updateData);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.review).toHaveProperty('rating', updateData.rating);
    });

    it('should return 400 for invalid rating', async () => {
      const res = await request(app)
        .patch(`/api/v1/reviews/${review._id}`)
        .set('Authorization', `Bearer ${providerToken}`)
        .send({ rating: 6 });

      expect(res.statusCode).toBe(400);
      expect(res.body.status).toBe('fail');
    });

    it('should return 400 for trying to change contract ID', async () => {
      const res = await request(app)
        .patch(`/api/v1/reviews/${review._id}`)
        .set('Authorization', `Bearer ${providerToken}`)
        .send({ contract: contract._id });

      expect(res.statusCode).toBe(400);
      expect(res.body.status).toBe('fail');
    });

    it('should return 403 for non-provider users', async () => {
      const res = await request(app)
        .patch(`/api/v1/reviews/${review._id}`)
        .set('Authorization', `Bearer ${taskerToken}`)
        .send({ rating: 4 });

      expect(res.statusCode).toBe(403);
    });

    it('should return 404 for non-existent review', async () => {
      const fakeId = '507f1f77bcf86cd799439011';
      const res = await request(app)
        .patch(`/api/v1/reviews/${fakeId}`)
        .set('Authorization', `Bearer ${providerToken}`)
        .send({ rating: 4 });

      expect(res.statusCode).toBe(404);
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app)
        .patch(`/api/v1/reviews/${review._id}`)
        .send({ rating: 4 });

      expect(res.statusCode).toBe(401);
    });
  });

  describe('DELETE /api/v1/reviews/:id', () => {
    it('should delete a review successfully', async () => {
      const res = await request(app)
        .delete(`/api/v1/reviews/${review._id}`)
        .set('Authorization', `Bearer ${providerToken}`);

      expect(res.statusCode).toBe(204);
    });

    it('should return 403 for non-provider users', async () => {
      const res = await request(app)
        .delete(`/api/v1/reviews/${review._id}`)
        .set('Authorization', `Bearer ${taskerToken}`);

      expect(res.statusCode).toBe(403);
    });

    it('should return 404 for non-existent review', async () => {
      const fakeId = '507f1f77bcf86cd799439011';
      const res = await request(app)
        .delete(`/api/v1/reviews/${fakeId}`)
        .set('Authorization', `Bearer ${providerToken}`);

      expect(res.statusCode).toBe(404);
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app).delete(`/api/v1/reviews/${review._id}`);
      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /api/v1/reviews/user/:userId', () => {
    it('should get reviews for a specific user', async () => {
      // Create unique gig and contract for this test
      const uniqueGig = await Gig.create({
        ...testGig,
        postedBy: provider._id,
        title: 'Unique Gig for User Review'
      });
      const uniqueContract = await Contract.create({
        gig: uniqueGig._id,
        provider: provider._id,
        tasker: tasker._id,
        status: 'completed',
        amount: 70.00,
        agreedCost: 70.00
      });
      // Ensure review has gig field and is for the tasker
      const userReview = await Review.create({
        contract: uniqueContract._id,
        gig: uniqueGig._id,
        reviewer: provider._id,
        reviewee: tasker._id,
        rating: 5,
        comment: 'Great work!'
      });
      const res = await request(app)
        .get(`/api/v1/reviews/user/${tasker._id}`)
        .set('Authorization', `Bearer ${providerToken}`);
      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.reviews.length).toBeGreaterThan(0);
      expect(res.body.data.reviews[0].reviewee).toBe(String(tasker._id));
    });
    it('should return 400 for invalid user ID', async () => {
      const res = await request(app)
        .get('/api/v1/reviews/user/invalidid')
        .set('Authorization', `Bearer ${providerToken}`);
      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /api/v1/reviews/average/:userId', () => {
    it('should get average rating for a user', async () => {
      // Create unique gig and contract for this test
      const uniqueGig = await Gig.create({
        ...testGig,
        postedBy: provider._id,
        title: 'Unique Gig for Avg Review'
      });
      const uniqueContract = await Contract.create({
        gig: uniqueGig._id,
        provider: provider._id,
        tasker: tasker._id,
        status: 'completed',
        amount: 80.00,
        agreedCost: 80.00
      });
      // Ensure review has gig field and is for the tasker
      const avgReview = await Review.create({
        contract: uniqueContract._id,
        gig: uniqueGig._id,
        reviewer: provider._id,
        reviewee: tasker._id,
        rating: 5,
        comment: 'Great work!'
      });
      const res = await request(app)
        .get(`/api/v1/reviews/average/${tasker._id}`)
        .set('Authorization', `Bearer ${providerToken}`);
      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data).toHaveProperty('averageRating');
      expect(res.body.data).toHaveProperty('reviewCount');
      expect(res.body.data.reviewCount).toBeGreaterThan(0);
    });
    it('should return 400 for invalid user ID', async () => {
      const res = await request(app)
        .get('/api/v1/reviews/average/invalidid')
        .set('Authorization', `Bearer ${providerToken}`);
      expect(res.statusCode).toBe(400);
    });
  });
}); 