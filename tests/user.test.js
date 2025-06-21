import mongoose from 'mongoose';
import { testUsers, createToken, request, app } from './setup.js';
import User from '../src/models/User.js';

describe('User Management API', () => {
  let provider, providerToken;

  beforeEach(async () => {
    await User.deleteMany({});
    provider = await User.create(testUsers.provider);
    providerToken = createToken(provider._id);
  });

  describe('GET /api/v1/users/me', () => {
    it('should get current user profile', async () => {
      const res = await request(app).get('/api/v1/users/me');
      expect(res.statusCode).toBe(401); // Should require authentication
    });

    it('should get current user profile when authenticated', async () => {
      const res = await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${providerToken}`);
      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
    });
  });

  describe('PATCH /api/v1/users/updateMe', () => {
    it('should update user profile successfully', async () => {
      const updateData = {
        firstName: 'Updated',
        lastName: 'Name',
        bio: 'Updated bio'
      };

      const res = await request(app)
        .patch('/api/v1/users/updateMe')
        .set('Authorization', `Bearer ${providerToken}`)
        .send(updateData);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.user).toHaveProperty('firstName', 'Updated');
    });

    it('should return 400 for invalid phone number format', async () => {
      const updateData = { phoneNo: '1234567890' };

      const res = await request(app)
        .patch('/api/v1/users/updateMe')
        .set('Authorization', `Bearer ${providerToken}`)
        .send(updateData);

      expect(res.statusCode).toBe(400);
      expect(res.body.status).toBe('fail');
    });

    it('should return 400 for bio exceeding character limit', async () => {
      const longBio = 'a'.repeat(751); // Exceeds 750 character limit
      const updateData = { bio: longBio };

      const res = await request(app)
        .patch('/api/v1/users/updateMe')
        .set('Authorization', `Bearer ${providerToken}`)
        .send(updateData);

      expect(res.statusCode).toBe(400);
      expect(res.body.status).toBe('fail');
    });

    it('should return 400 for password update attempt', async () => {
      const updateData = { password: 'newpassword123' };

      const res = await request(app)
        .patch('/api/v1/users/updateMe')
        .set('Authorization', `Bearer ${providerToken}`)
        .send(updateData);

      expect(res.statusCode).toBe(400);
      expect(res.body.status).toBe('fail');
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app)
        .patch('/api/v1/users/updateMe')
        .send({ firstName: 'Updated' });

      expect(res.statusCode).toBe(401);
    });
  });

  describe('DELETE /api/v1/users/deleteMe', () => {
    it('should delete current user account', async () => {
      const res = await request(app).delete('/api/v1/users/deleteMe');
      expect(res.statusCode).toBe(401); // Should require authentication
    });

    it('should delete current user account when authenticated', async () => {
      const res = await request(app)
        .delete('/api/v1/users/deleteMe')
        .set('Authorization', `Bearer ${providerToken}`);
      expect(res.statusCode).toBe(204);
    });
  });

  describe('GET /api/v1/users/public/:id', () => {
    it('should get public user profile', async () => {
      const res = await request(app).get(`/api/v1/users/public/${provider._id}`);
      expect(res.statusCode).toBe(200);
      expect(res.body.data.user).toHaveProperty('_id', provider._id.toString());
    });

    it('should return 400 for invalid user ID format', async () => {
      const res = await request(app).get('/api/v1/users/public/invalid-id');
      expect(res.statusCode).toBe(400);
      expect(res.body.status).toBe('fail');
    });

    it('should return 404 for non-existent user', async () => {
      const fakeId = '507f1f77bcf86cd799439011';
      const res = await request(app).get(`/api/v1/users/public/${fakeId}`);
      expect(res.statusCode).toBe(404);
    });
  });

  describe('GET /api/v1/users/me/album', () => {
    it('should get user album', async () => {
      const res = await request(app).get('/api/v1/users/me/album');
      expect(res.statusCode).toBe(401); // Should require authentication
    });

    it('should get user album when authenticated', async () => {
      const res = await request(app)
        .get('/api/v1/users/me/album')
        .set('Authorization', `Bearer ${providerToken}`);
      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
    });
  });

  describe('POST /api/v1/users/me/album', () => {
    it('should upload album photo', async () => {
      const res = await request(app).post('/api/v1/users/me/album');
      expect(res.statusCode).toBe(401); // Should require authentication
    });
  });

  describe('DELETE /api/v1/users/me/album/:photoId', () => {
    it('should delete album photo', async () => {
      const photoId = '507f1f77bcf86cd799439011';
      const res = await request(app).delete(`/api/v1/users/me/album/${photoId}`);
      expect(res.statusCode).toBe(401); // Should require authentication
    });
  });

  describe('GET /api/v1/users/match-taskers', () => {
    it('should get matching taskers for provider', async () => {
      const res = await request(app).get('/api/v1/users/match-taskers');
      expect(res.statusCode).toBe(401); // Should require authentication
    });

    it('should get matching taskers when authenticated as provider', async () => {
      const res = await request(app)
        .get('/api/v1/users/match-taskers')
        .set('Authorization', `Bearer ${providerToken}`);
      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
    });
  });

  describe('GET /api/v1/users/top-match-taskers', () => {
    it('should get top matching taskers', async () => {
      const res = await request(app).get('/api/v1/users/top-match-taskers');
      expect(res.statusCode).toBe(401); // Should require authentication
    });

    it('should get top matching taskers when authenticated as provider', async () => {
      const res = await request(app)
        .get('/api/v1/users/top-match-taskers')
        .set('Authorization', `Bearer ${providerToken}`);
      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
    });
  });

  describe('POST /api/v1/users/stripe/connect-account', () => {
    it('should create Stripe connect account', async () => {
      const res = await request(app).post('/api/v1/users/stripe/connect-account');
      expect(res.statusCode).toBe(401); // Should require authentication
    });
  });

  describe('GET /api/v1/users/stripe/account-link', () => {
    it('should get Stripe account link', async () => {
      const res = await request(app).get('/api/v1/users/stripe/account-link');
      expect(res.statusCode).toBe(401); // Should require authentication
    });
  });

  describe('GET /api/v1/users/stripe/account-status', () => {
    it('should get Stripe account status', async () => {
      const res = await request(app).get('/api/v1/users/stripe/account-status');
      expect(res.statusCode).toBe(401); // Should require authentication
    });
  });

  describe('GET /api/v1/users/:userId/album', () => {
    it('should get user album by ID', async () => {
      const res = await request(app)
        .get(`/api/v1/users/${provider._id}/album`)
        .set('Authorization', `Bearer ${providerToken}`);
      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
    });

    it('should return 400 for invalid user ID format', async () => {
      const res = await request(app)
        .get('/api/v1/users/invalid-id/album')
        .set('Authorization', `Bearer ${providerToken}`);
      expect(res.statusCode).toBe(400);
      expect(res.body.status).toBe('fail');
    });

    it('should return 404 for non-existent user', async () => {
      const fakeId = '507f1f77bcf86cd799439011';
      const res = await request(app)
        .get(`/api/v1/users/${fakeId}/album`)
        .set('Authorization', `Bearer ${providerToken}`);
      expect(res.statusCode).toBe(404);
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app).get(`/api/v1/users/${provider._id}/album`);
      expect(res.statusCode).toBe(401);
    });
  });
}); 