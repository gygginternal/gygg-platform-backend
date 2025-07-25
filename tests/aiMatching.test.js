const request = require('supertest');
const app = require('../app');
const User = require('../src/models/User');
const { connectDB, clearDB, closeDB } = require('./setup');

describe('AI Matching API', () => {
  let providerToken, taskerToken, provider, tasker;

  beforeAll(async () => {
    await connectDB();
  });

  afterAll(async () => {
    await clearDB();
    await closeDB();
  });

  beforeEach(async () => {
    // Create test users
    provider = await User.create({
      firstName: 'John',
      lastName: 'Provider',
      email: 'provider@test.com',
      password: 'password123',
      role: ['provider'],
      hobbies: ['reading', 'gardening', 'photography'],
      skills: ['project management', 'communication', 'leadership'],
      address: {
        city: 'Toronto',
        state: 'Ontario',
        country: 'Canada'
      },
      personality: ['organized', 'social', 'reliable']
    });

    tasker = await User.create({
      firstName: 'Jane',
      lastName: 'Tasker',
      email: 'tasker@test.com',
      password: 'password123',
      role: ['tasker'],
      hobbies: ['reading', 'cooking', 'photography'],
      skills: ['web development', 'design', 'communication'],
      address: {
        city: 'Toronto',
        state: 'Ontario',
        country: 'Canada'
      },
      personality: ['creative', 'detail-oriented', 'flexible'],
      rating: 4.5,
      ratePerHour: 50
    });

    // Get auth tokens
    const providerLogin = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'provider@test.com',
        password: 'password123'
      });
    providerToken = providerLogin.body.token;

    const taskerLogin = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'tasker@test.com',
        password: 'password123'
      });
    taskerToken = taskerLogin.body.token;
  });

  afterEach(async () => {
    await User.deleteMany({});
  });

  describe('GET /api/ai-matching/taskers/:providerId', () => {
    it('should find matching taskers for a provider', async () => {
      const response = await request(app)
        .get(`/api/ai-matching/taskers/${provider._id}`)
        .set('Authorization', `Bearer ${providerToken}`)
        .expect(200);

      expect(response.body.status).toBe('success');
      expect(response.body.data.matches).toBeInstanceOf(Array);
      expect(response.body.data.matches[0]).toHaveProperty('matchScore');
      expect(response.body.data.matches[0]).toHaveProperty('matchBreakdown');
      expect(response.body.data.matches[0]).toHaveProperty('matchReasons');
    });

    it('should filter by minimum score', async () => {
      const response = await request(app)
        .get(`/api/ai-matching/taskers/${provider._id}`)
        .query({ minScore: 80 })
        .set('Authorization', `Bearer ${providerToken}`)
        .expect(200);

      response.body.data.matches.forEach(match => {
        expect(match.matchScore).toBeGreaterThanOrEqual(80);
      });
    });

    it('should limit results', async () => {
      const response = await request(app)
        .get(`/api/ai-matching/taskers/${provider._id}`)
        .query({ limit: 5 })
        .set('Authorization', `Bearer ${providerToken}`)
        .expect(200);

      expect(response.body.data.matches.length).toBeLessThanOrEqual(5);
    });

    it('should sort by different criteria', async () => {
      const scoreResponse = await request(app)
        .get(`/api/ai-matching/taskers/${provider._id}`)
        .query({ sortBy: 'score' })
        .set('Authorization', `Bearer ${providerToken}`)
        .expect(200);

      const ratingResponse = await request(app)
        .get(`/api/ai-matching/taskers/${provider._id}`)
        .query({ sortBy: 'rating' })
        .set('Authorization', `Bearer ${providerToken}`)
        .expect(200);

      // Verify sorting
      if (scoreResponse.body.data.matches.length > 1) {
        expect(scoreResponse.body.data.matches[0].matchScore)
          .toBeGreaterThanOrEqual(scoreResponse.body.data.matches[1].matchScore);
      }
    });

    it('should return 403 for unauthorized access', async () => {
      await request(app)
        .get(`/api/ai-matching/taskers/${provider._id}`)
        .set('Authorization', `Bearer ${taskerToken}`)
        .expect(403);
    });

    it('should return 404 for non-existent provider', async () => {
      const fakeId = '507f1f77bcf86cd799439011';
      await request(app)
        .get(`/api/ai-matching/taskers/${fakeId}`)
        .set('Authorization', `Bearer ${providerToken}`)
        .expect(404);
    });
  });

  describe('GET /api/ai-matching/providers/:taskerId', () => {
    it('should find matching providers for a tasker', async () => {
      const response = await request(app)
        .get(`/api/ai-matching/providers/${tasker._id}`)
        .set('Authorization', `Bearer ${taskerToken}`)
        .expect(200);

      expect(response.body.status).toBe('success');
      expect(response.body.data.matches).toBeInstanceOf(Array);
      expect(response.body.data.matches[0]).toHaveProperty('matchScore');
      expect(response.body.data.matches[0]).toHaveProperty('matchBreakdown');
    });

    it('should filter providers with active gigs', async () => {
      const response = await request(app)
        .get(`/api/ai-matching/providers/${tasker._id}`)
        .query({ hasActiveGigs: true })
        .set('Authorization', `Bearer ${taskerToken}`)
        .expect(200);

      expect(response.body.status).toBe('success');
    });
  });

  describe('GET /api/ai-matching/insights/:userId', () => {
    it('should return matching insights for a user', async () => {
      const response = await request(app)
        .get(`/api/ai-matching/insights/${provider._id}`)
        .set('Authorization', `Bearer ${providerToken}`)
        .expect(200);

      expect(response.body.status).toBe('success');
      expect(response.body.data.insights).toHaveProperty('totalPotentialMatches');
      expect(response.body.data.insights).toHaveProperty('averageMatchScore');
      expect(response.body.data.insights).toHaveProperty('recommendations');
      expect(response.body.data.userProfile).toHaveProperty('hobbies');
      expect(response.body.data.userProfile).toHaveProperty('skills');
    });
  });

  describe('POST /api/ai-matching/batch', () => {
    it('should perform batch matching (admin only)', async () => {
      // Create admin user
      const admin = await User.create({
        firstName: 'Admin',
        lastName: 'User',
        email: 'admin@test.com',
        password: 'password123',
        role: ['admin']
      });

      const adminLogin = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'admin@test.com',
          password: 'password123'
        });

      const response = await request(app)
        .post('/api/ai-matching/batch')
        .set('Authorization', `Bearer ${adminLogin.body.token}`)
        .send({
          userIds: [provider._id],
          targetRole: 'tasker'
        })
        .expect(200);

      expect(response.body.status).toBe('success');
      expect(response.body.data.batchResults).toBeInstanceOf(Array);
    });

    it('should return 403 for non-admin users', async () => {
      await request(app)
        .post('/api/ai-matching/batch')
        .set('Authorization', `Bearer ${providerToken}`)
        .send({
          userIds: [provider._id],
          targetRole: 'tasker'
        })
        .expect(403);
    });
  });

  describe('Rate Limiting', () => {
    it('should apply rate limiting after too many requests', async () => {
      // Make multiple requests quickly
      const requests = Array(60).fill().map(() =>
        request(app)
          .get(`/api/ai-matching/taskers/${provider._id}`)
          .set('Authorization', `Bearer ${providerToken}`)
      );

      const responses = await Promise.all(requests);
      
      // Some requests should be rate limited
      const rateLimitedResponses = responses.filter(res => res.status === 429);
      expect(rateLimitedResponses.length).toBeGreaterThan(0);
    }, 10000);
  });

  describe('Input Validation', () => {
    it('should validate limit parameter', async () => {
      await request(app)
        .get(`/api/ai-matching/taskers/${provider._id}`)
        .query({ limit: 'invalid' })
        .set('Authorization', `Bearer ${providerToken}`)
        .expect(400);

      await request(app)
        .get(`/api/ai-matching/taskers/${provider._id}`)
        .query({ limit: 101 })
        .set('Authorization', `Bearer ${providerToken}`)
        .expect(400);
    });

    it('should validate minScore parameter', async () => {
      await request(app)
        .get(`/api/ai-matching/taskers/${provider._id}`)
        .query({ minScore: 'invalid' })
        .set('Authorization', `Bearer ${providerToken}`)
        .expect(400);

      await request(app)
        .get(`/api/ai-matching/taskers/${provider._id}`)
        .query({ minScore: 101 })
        .set('Authorization', `Bearer ${providerToken}`)
        .expect(400);
    });

    it('should validate sortBy parameter', async () => {
      await request(app)
        .get(`/api/ai-matching/taskers/${provider._id}`)
        .query({ sortBy: 'invalid' })
        .set('Authorization', `Bearer ${providerToken}`)
        .expect(400);
    });
  });

  describe('Caching', () => {
    it('should cache matching results', async () => {
      const response1 = await request(app)
        .get(`/api/ai-matching/taskers/${provider._id}`)
        .set('Authorization', `Bearer ${providerToken}`)
        .expect(200);

      const response2 = await request(app)
        .get(`/api/ai-matching/taskers/${provider._id}`)
        .set('Authorization', `Bearer ${providerToken}`)
        .expect(200);

      expect(response2.body.cached).toBe(true);
      expect(response2.body.cacheTimestamp).toBeDefined();
    });
  });
});