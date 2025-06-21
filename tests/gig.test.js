import mongoose from 'mongoose';
import { testUsers, testGig, createToken, request, app } from './setup.js';
import User from '../src/models/User.js';
import { Gig } from '../src/models/Gig.js';

describe('Gig API', () => {
  let provider, tasker, providerToken, taskerToken, gig;

  beforeEach(async () => {
    await User.deleteMany({});
    await Gig.deleteMany({});

    // Create test users
    provider = await User.create(testUsers.provider);
    tasker = await User.create(testUsers.tasker);

    // Create tokens
    providerToken = createToken(provider._id);
    taskerToken = createToken(tasker._id);

    // Create test gig
    gig = await Gig.create({
      ...testGig,
      postedBy: provider._id
    });
  });

  describe('GET /api/v1/gigs', () => {
    it('should get all gigs with authentication', async () => {
      const res = await request(app)
        .get('/api/v1/gigs')
        .set('Authorization', `Bearer ${providerToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
      expect(Array.isArray(res.body.data.gigs)).toBe(true);
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app).get('/api/v1/gigs');
      expect(res.statusCode).toBe(401);
    });

    it('should support pagination', async () => {
      const res = await request(app)
        .get('/api/v1/gigs?page=1&limit=10')
        .set('Authorization', `Bearer ${providerToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
    });

    it('should filter by category', async () => {
      const res = await request(app)
        .get('/api/v1/gigs?category=Household Services')
        .set('Authorization', `Bearer ${providerToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
    });

    it('should filter by status', async () => {
      const res = await request(app)
        .get('/api/v1/gigs?status=open')
        .set('Authorization', `Bearer ${providerToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
    });
  });

  describe('POST /api/v1/gigs', () => {
    it('should create a new gig successfully', async () => {
      const newGig = {
        title: 'New Test Gig',
        description: 'A new test gig description',
        category: 'Household Services',
        cost: 50.00,
        location: {
          address: '123 Test St',
          city: 'Test City',
          state: 'TS',
          postalCode: '12345',
          country: 'Test Country'
        },
        isRemote: false,
        skills: ['cleaning', 'organizing']
      };

      const res = await request(app)
        .post('/api/v1/gigs')
        .set('Authorization', `Bearer ${providerToken}`)
        .send(newGig);

      expect(res.statusCode).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data.gig).toHaveProperty('title', newGig.title);
    });

    it('should return 400 for missing required fields', async () => {
      const res = await request(app)
        .post('/api/v1/gigs')
        .set('Authorization', `Bearer ${providerToken}`)
        .send({ title: 'Incomplete Gig' });

      expect(res.statusCode).toBe(400);
      expect(res.body.status).toBe('fail');
    });

    it('should return 403 for non-provider users', async () => {
      const res = await request(app)
        .post('/api/v1/gigs')
        .set('Authorization', `Bearer ${taskerToken}`)
        .send(testGig);

      expect(res.statusCode).toBe(403);
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app)
        .post('/api/v1/gigs')
        .send(testGig);

      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /api/v1/gigs/:id', () => {
    it('should get a specific gig', async () => {
      const res = await request(app)
        .get(`/api/v1/gigs/${gig._id}`)
        .set('Authorization', `Bearer ${providerToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.gig).toHaveProperty('_id', gig._id.toString());
    });

    it('should return 404 for non-existent gig', async () => {
      const fakeId = '507f1f77bcf86cd799439011';
      const res = await request(app)
        .get(`/api/v1/gigs/${fakeId}`)
        .set('Authorization', `Bearer ${providerToken}`);

      expect(res.statusCode).toBe(404);
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app).get(`/api/v1/gigs/${gig._id}`);
      expect(res.statusCode).toBe(401);
    });
  });

  describe('PATCH /api/v1/gigs/:id', () => {
    it('should update a gig successfully', async () => {
      const updateData = {
        title: 'Updated Gig Title',
        description: 'Updated description with at least 20 characters.'
      };

      const res = await request(app)
        .patch(`/api/v1/gigs/${gig._id}`)
        .set('Authorization', `Bearer ${providerToken}`)
        .send(updateData);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.gig).toHaveProperty('title', updateData.title);
    });

    it('should return 404 for non-existent gig', async () => {
      const fakeId = '507f1f77bcf86cd799439011';
      const res = await request(app)
        .patch(`/api/v1/gigs/${fakeId}`)
        .set('Authorization', `Bearer ${providerToken}`)
        .send({ title: 'Updated Title' });

      expect(res.statusCode).toBe(404);
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app)
        .patch(`/api/v1/gigs/${gig._id}`)
        .send({ title: 'Updated Title' });

      expect(res.statusCode).toBe(401);
    });
  });

  describe('DELETE /api/v1/gigs/:id', () => {
    it('should delete a gig successfully', async () => {
      const res = await request(app)
        .delete(`/api/v1/gigs/${gig._id}`)
        .set('Authorization', `Bearer ${providerToken}`);

      expect(res.statusCode).toBe(204);
    });

    it('should return 404 for non-existent gig', async () => {
      const fakeId = '507f1f77bcf86cd799439011';
      const res = await request(app)
        .delete(`/api/v1/gigs/${fakeId}`)
        .set('Authorization', `Bearer ${providerToken}`);

      expect(res.statusCode).toBe(404);
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app).delete(`/api/v1/gigs/${gig._id}`);
      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /api/v1/gigs/top-match', () => {
    it('should get top matching gigs for tasker', async () => {
      const res = await request(app)
        .get('/api/v1/gigs/top-match')
        .set('Authorization', `Bearer ${taskerToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app).get('/api/v1/gigs/top-match');
      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /api/v1/gigs/awaiting-posted-gig', () => {
    it('should get gigs with no applications for provider', async () => {
      const res = await request(app)
        .get('/api/v1/gigs/awaiting-posted-gig')
        .set('Authorization', `Bearer ${providerToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
    });

    it('should return 403 for non-provider users', async () => {
      const res = await request(app)
        .get('/api/v1/gigs/awaiting-posted-gig')
        .set('Authorization', `Bearer ${taskerToken}`);

      expect(res.statusCode).toBe(403);
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app).get('/api/v1/gigs/awaiting-posted-gig');
      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /api/v1/gigs/:gigId/offer', () => {
    it('should get offer for a specific gig', async () => {
      const res = await request(app)
        .get(`/api/v1/gigs/${gig._id}/offer`)
        .set('Authorization', `Bearer ${providerToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
    });

    it('should return 404 for non-existent gig', async () => {
      const fakeId = '507f1f77bcf86cd799439011';
      const res = await request(app)
        .get(`/api/v1/gigs/${fakeId}/offer`)
        .set('Authorization', `Bearer ${providerToken}`);

      expect(res.statusCode).toBe(404);
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app).get(`/api/v1/gigs/${gig._id}/offer`);
      expect(res.statusCode).toBe(401);
    });
  });
}); 