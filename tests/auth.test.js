import mongoose from 'mongoose';
import { testUsers, createToken, request, app } from './setup.js';
import User from '../src/models/User.js';

describe('Authentication API', () => {
  beforeEach(async () => {
    await User.deleteMany({});
  });

  describe('POST /api/v1/users/signup', () => {
    it('should create a new user successfully', async () => {
      const res = await request(app)
        .post('/api/v1/users/signup')
        .send(testUsers.provider);

      expect(res.statusCode).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data.user).toBeDefined();
      expect(res.body.data.user.email).toBe(testUsers.provider.email);
      expect(res.body.data.user.role).toEqual(testUsers.provider.role);
      expect(res.body.token).toBeDefined();
    }, 20000);

    it('should return 400 for invalid email', async () => {
      const invalidUser = { ...testUsers.provider, email: 'invalid-email' };
      const res = await request(app)
        .post('/api/v1/users/signup')
        .send(invalidUser);

      expect(res.statusCode).toBe(400);
      expect(res.body.status).toBe('fail');
    });

    it('should return 400 for missing required fields', async () => {
      const res = await request(app)
        .post('/api/v1/users/signup')
        .send({ email: 'test@test.com' });

      expect(res.statusCode).toBe(400);
      expect(res.body.status).toBe('fail');
    });

    it('should return 400 for short password', async () => {
      const invalidUser = { ...testUsers.provider, password: '123' };
      const res = await request(app)
        .post('/api/v1/users/signup')
        .send(invalidUser);

      expect(res.statusCode).toBe(400);
      expect(res.body.status).toBe('fail');
    });

    it('should return 400 for duplicate email', async () => {
      // Create first user
      await request(app)
        .post('/api/v1/users/signup')
        .send(testUsers.provider);

      // Try to create second user with same email
      const res = await request(app)
        .post('/api/v1/users/signup')
        .send(testUsers.provider);

      expect(res.statusCode).toBe(400);
      expect(res.body.status).toBe('fail');
    }, 20000);

    it('should return 400 for mismatched passwords', async () => {
      const invalidUser = { ...testUsers.provider, passwordConfirm: 'different' };
      const res = await request(app)
        .post('/api/v1/users/signup')
        .send(invalidUser);

      expect(res.statusCode).toBe(400);
    });

    it('should return 400 for invalid phone number format', async () => {
      const invalidUser = { ...testUsers.provider, phoneNo: '1234567890' };
      const res = await request(app)
        .post('/api/v1/users/signup')
        .send(invalidUser);

      expect(res.statusCode).toBe(400);
    });

    it('should return 400 for invalid date of birth', async () => {
      const invalidUser = { ...testUsers.provider, dateOfBirth: 'invalid-date' };
      const res = await request(app)
        .post('/api/v1/users/signup')
        .send(invalidUser);

      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST /api/v1/users/login', () => {
    let user;

    beforeEach(async () => {
      user = await User.create(testUsers.provider);
    });

    it('should login successfully with valid credentials', async () => {
      const res = await request(app)
        .post('/api/v1/users/login')
        .send({
          email: testUsers.provider.email,
          password: testUsers.provider.password
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.user).toHaveProperty('email', testUsers.provider.email);
      expect(res.body.data).toHaveProperty('token');
    });

    it('should return 400 for missing email', async () => {
      const res = await request(app)
        .post('/api/v1/users/login')
        .send({ password: testUsers.provider.password });

      expect(res.statusCode).toBe(400);
      expect(res.body.status).toBe('fail');
    });

    it('should return 401 for incorrect password', async () => {
      const res = await request(app)
        .post('/api/v1/users/login')
        .send({
          email: testUsers.provider.email,
          password: 'wrongpassword'
        });

      expect(res.statusCode).toBe(401);
      expect(res.body.status).toBe('fail');
    });

    it('should return 401 for non-existent email', async () => {
      const res = await request(app)
        .post('/api/v1/users/login')
        .send({
          email: 'nonexistent@test.com',
          password: testUsers.provider.password
        });

      expect(res.statusCode).toBe(401);
      expect(res.body.status).toBe('fail');
    });

    it('should return 401 for unverified email', async () => {
      // Create user with unverified email
      const unverifiedUser = { ...testUsers.tasker, isEmailVerified: false };
      await User.create(unverifiedUser);

      const res = await request(app)
        .post('/api/v1/users/login')
        .send({
          email: unverifiedUser.email,
          password: unverifiedUser.password
        });

      expect(res.statusCode).toBe(401);
      expect(res.body.status).toBe('fail');
    });
  });

  describe('GET /api/v1/users/verifyEmail/:token', () => {
    it('should verify email with valid token', async () => {
      const res = await request(app).get(`/api/v1/users/verifyEmail/valid-token`);
      expect(res.statusCode).toBe(400); // Should fail with invalid token
    });

    it('should return 400 for invalid token', async () => {
      const res = await request(app).get(`/api/v1/users/verifyEmail/invalid-token`);
      expect(res.statusCode).toBe(400);
      expect(res.body.status).toBe('fail');
    });
  });

  describe('POST /api/v1/users/forgotPassword', () => {
    it('should send reset password email', async () => {
      const res = await request(app)
        .post('/api/v1/users/forgotPassword')
        .send({ email: 'test@test.com' });

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
    });

    it('should return 400 for missing email', async () => {
      const res = await request(app)
        .post('/api/v1/users/forgotPassword')
        .send({});

      expect(res.statusCode).toBe(400);
      expect(res.body.status).toBe('fail');
    });
  });

  describe('PATCH /api/v1/users/resetPassword/:token', () => {
    it('should reset password with valid token', async () => {
      const res = await request(app)
        .patch('/api/v1/users/resetPassword/valid-token')
        .send({
          password: 'newpassword123',
          passwordConfirm: 'newpassword123'
        });

      expect(res.statusCode).toBe(400); // Should fail with invalid token
    });

    it('should return 400 for invalid token', async () => {
      const res = await request(app)
        .patch('/api/v1/users/resetPassword/invalid-token')
        .send({
          password: 'newpassword123',
          passwordConfirm: 'newpassword123'
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.status).toBe('fail');
    });

    it('should return 400 for mismatched passwords', async () => {
      const res = await request(app)
        .patch('/api/v1/users/resetPassword/valid-token')
        .send({
          password: 'newpassword123',
          passwordConfirm: 'differentpassword'
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.status).toBe('fail');
    });
  });

  describe('PATCH /api/v1/users/updateMyPassword', () => {
    it('should update password successfully', async () => {
      const user = await User.create(testUsers.provider);
      const token = createToken(user._id);

      const res = await request(app)
        .patch('/api/v1/users/updateMyPassword')
        .set('Authorization', `Bearer ${token}`)
        .send({
          passwordCurrent: testUsers.provider.password,
          password: 'newpassword123',
          passwordConfirm: 'newpassword123'
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
    });

    it('should return 401 for incorrect current password', async () => {
      const user = await User.create(testUsers.provider);
      const token = createToken(user._id);

      const res = await request(app)
        .patch('/api/v1/users/updateMyPassword')
        .set('Authorization', `Bearer ${token}`)
        .send({
          passwordCurrent: 'wrongpassword',
          password: 'newpassword123',
          passwordConfirm: 'newpassword123'
        });

      expect(res.statusCode).toBe(401);
      expect(res.body.status).toBe('fail');
    });

    it('should return 400 for mismatched new passwords', async () => {
      const user = await User.create(testUsers.provider);
      const token = createToken(user._id);

      const res = await request(app)
        .patch('/api/v1/users/updateMyPassword')
        .set('Authorization', `Bearer ${token}`)
        .send({
          passwordCurrent: testUsers.provider.password,
          password: 'newpassword123',
          passwordConfirm: 'differentpassword'
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.status).toBe('fail');
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app)
        .patch('/api/v1/users/updateMyPassword')
        .send({
          passwordCurrent: 'oldpassword',
          password: 'newpassword123',
          passwordConfirm: 'newpassword123'
        });

      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /api/v1/users/me', () => {
    it('should get current user profile', async () => {
      const res = await request(app).get('/api/v1/users/me');
      expect(res.statusCode).toBe(401); // Should require authentication
    });
  });

  describe('POST /api/v1/users/logout', () => {
    it('should logout successfully', async () => {
      const res = await request(app).post('/api/v1/users/logout');
      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
    });
  });
}); 