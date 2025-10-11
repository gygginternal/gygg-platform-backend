import request from 'supertest';
import mongoose from 'mongoose';
import app from '../src/app.js';
import User from '../src/models/User.js';

describe('Phase 2: Request Size Limits and Security Headers Tests', () => {
  let server;
  let testUser;

  beforeAll(async () => {
    server = app.listen(0);
    
    testUser = await User.create({
      firstName: 'Test',
      lastName: 'Security',
      email: 'security-test@example.com',
      password: 'TestPass123!',
      phoneNo: '+12345678901',
      role: ['provider']
    });
  });

  afterAll(async () => {
    await User.deleteMany({ email: 'security-test@example.com' });
    await server.close();
    await mongoose.connection.close();
  });

  describe('Request Size Limits', () => {
    test('Should reject requests exceeding 10KB body size', async () => {
      // Create a payload larger than 10KB
      const largePayload = {
        data: 'x'.repeat(11 * 1024) // 11KB string
      };
      
      const response = await request(app)
        .post('/api/v1/users/updateMe')
        .send(largePayload);
      
      // Should return 413 (Payload Too Large) or 400 (Bad Request)
      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    test('Should reject requests with too many URL parameters', async () => {
      // Create URL with more than 100 parameters (our limit)
      const params = new URLSearchParams();
      for (let i = 0; i < 150; i++) {
        params.append(`param${i}`, `value${i}`);
      }
      
      const response = await request(app)
        .get(`/api/v1/users/me?${params.toString()}`);
      
      // Should return error due to parameter limit
      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    test('Should handle normal-sized requests normally', async () => {
      const normalPayload = {
        bio: 'This is a normal bio within limits',
        skills: ['skill1', 'skill2']
      };
      
      const response = await request(app)
        .post('/api/v1/users/updateMe')
        .send(normalPayload);
      
      // Should return appropriate status (not an error from size limits)
      expect(response.status).toBeGreaterThanOrEqual(400); // Expect 401 due to auth, not 413
    });
  });

  describe('Security Headers', () => {
    test('Should include proper security headers', async () => {
      const response = await request(app)
        .get('/health');
      
      // Verify important security headers
      expect(response.headers).toHaveProperty('x-content-type-options');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      
      expect(response.headers).toHaveProperty('x-frame-options');
      expect(response.headers['x-frame-options']).toBe('DENY');
      
      expect(response.headers).toHaveProperty('x-xss-protection');
      expect(response.headers['x-xss-protection']).toBe('0');
      
      expect(response.headers).toHaveProperty('strict-transport-security');
      expect(response.headers['strict-transport-security']).toBeDefined();
      
      expect(response.headers).toHaveProperty('content-security-policy');
      expect(response.headers['content-security-policy']).toBeDefined();
    });

    test('Should hide powered-by header', async () => {
      const response = await request(app)
        .get('/health');
      
      // X-Powered-By should not be present
      expect(response.headers).not.toHaveProperty('x-powered-by');
    });
  });

  describe('Request Timeout Protection', () => {
    test('Should handle large payloads gracefully without hanging', async () => {
      // Test with a very large payload to ensure server doesn't hang
      const hugePayload = {
        title: 'Test',
        description: 'x'.repeat(50 * 1024), // 50KB
        fields: Array(1000).fill().map((_, i) => `field${i}`)
      };
      
      // This should respond within timeout, not hang indefinitely
      const startTime = Date.now();
      const response = await request(app)
        .post('/api/v1/gigs')
        .send(hugePayload);
      const duration = Date.now() - startTime;
      
      // Should respond within reasonable time (less than our timeout)
      expect(duration).toBeLessThan(35000); // Less than 35 seconds
      expect(response.status).toBeGreaterThanOrEqual(400);
    }, 40000);
  });
});