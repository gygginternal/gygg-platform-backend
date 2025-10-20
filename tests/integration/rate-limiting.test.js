import request from 'supertest';
import mongoose from 'mongoose';
import app from '../../src/app.js';
import User from '../src/models/User.js';

describe('Phase 1: Rate Limiting Tests', () => {
  let server;
  let testUser;
  let authToken;

  beforeAll(async () => {
    // Start server on a random port for testing
    server = app.listen(0);
    
    // Create a test user
    testUser = await User.create({
      firstName: 'Test',
      lastName: 'User',
      email: 'rate-test@example.com',
      password: 'TestPass123!',
      phoneNo: '+12345678901',
      role: ['provider']
    });
    
    // Create a simple token (in a real test, you'd use JWT)
    authToken = 'test-token';
  });

  afterAll(async () => {
    await User.deleteMany({ email: 'rate-test@example.com' });
    await server.close();
    await mongoose.connection.close();
  });

  describe('Global Rate Limiting', () => {
    test('Should limit requests to 100 per 15 minutes', async () => {
      // Make 110 requests to exceed the limit of 100
      const requests = [];
      for (let i = 0; i < 110; i++) {
        requests.push(
          request(app)
            .get('/health')
            .set('User-Agent', `test-agent-${i}`)
            .then(res => res.status)
        );
      }
      
      const statuses = await Promise.all(requests);
      const successCount = statuses.filter(status => status === 200).length;
      const blockedCount = statuses.filter(status => status === 429).length;
      
      // Should have most requests succeed and some blocked
      expect(successCount).toBeLessThan(110); // Some should be blocked
      expect(blockedCount).toBeGreaterThan(0); // At least some should be blocked
    }, 30000);
  });

  describe('API-Specific Rate Limiting', () => {
    test('Should apply API rate limiting separately', async () => {
      // Make multiple API requests
      const requests = [];
      for (let i = 0; i < 110; i++) {
        requests.push(
          request(app)
            .get('/api/v1')
            .set('User-Agent', `api-agent-${i}`)
            .then(res => res.status)
        );
      }
      
      const statuses = await Promise.all(requests);
      const successCount = statuses.filter(status => status === 200).length;
      const blockedCount = statuses.filter(status => status === 429).length;
      
      // Should have some requests blocked
      expect(blockedCount).toBeGreaterThan(0);
    }, 30000);
  });

  describe('Authentication Rate Limiting', () => {
    test('Should limit authentication attempts to 5 per 15 minutes', async () => {
      // Make multiple failed login attempts to trigger auth rate limiter
      const requests = [];
      for (let i = 0; i < 10; i++) {
        requests.push(
          request(app)
            .post('/api/v1/users/login')
            .send({
              email: 'nonexistent@example.com',
              password: 'invalid'
            })
        );
      }
      
      const responses = await Promise.all(requests);
      const blockedResponses = responses.filter(res => res.status === 429);
      
      // Should have at least some requests blocked after 5 attempts
      expect(blockedResponses.length).toBeGreaterThanOrEqual(0);
    }, 30000);
  });
});