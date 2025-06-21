import mongoose from 'mongoose';
import { testUsers, createToken, request, app } from './setup.js';
import User from '../src/models/User.js';
import Notification from '../src/models/Notification.js';

describe('Notification API', () => {
  let user, userToken, notification;

  beforeEach(async () => {
    await User.deleteMany({});
    await Notification.deleteMany({});

    // Create test user
    user = await User.create(testUsers.provider);
    userToken = createToken(user._id);

    // Create test notification
    notification = await Notification.create({
      user: user._id,
      message: 'You have received a new gig application',
      type: 'gig_application',
      isRead: false
    });
  });

  describe('GET /api/v1/notifications', () => {
    it('should get all notifications for authenticated user', async () => {
      const res = await request(app)
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
      expect(Array.isArray(res.body.data.notifications)).toBe(true);
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app).get('/api/v1/notifications');
      expect(res.statusCode).toBe(401);
    });

    it('should support pagination', async () => {
      const res = await request(app)
        .get('/api/v1/notifications?page=1&limit=10')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
    });
  });

  describe('GET /api/v1/notifications/:id', () => {
    it('should get a specific notification', async () => {
      const res = await request(app)
        .get(`/api/v1/notifications/${notification._id}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.notification).toHaveProperty('_id', notification._id.toString());
    });

    it('should return 404 for non-existent notification', async () => {
      const fakeId = '507f1f77bcf86cd799439011';
      const res = await request(app)
        .get(`/api/v1/notifications/${fakeId}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(404);
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app).get(`/api/v1/notifications/${notification._id}`);
      expect(res.statusCode).toBe(401);
    });
  });

  describe('PATCH /api/v1/notifications/:id/read', () => {
    it('should mark a notification as read successfully', async () => {
      const res = await request(app)
        .patch(`/api/v1/notifications/${notification._id}/read`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.notification.isRead).toBe(true);
    });

    it('should return 404 for non-existent notification', async () => {
      const fakeId = '507f1f77bcf86cd799439011';
      const res = await request(app)
        .patch(`/api/v1/notifications/${fakeId}/read`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(404);
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app).patch(`/api/v1/notifications/${notification._id}/read`);
      expect(res.statusCode).toBe(401);
    });
  });

  describe('DELETE /api/v1/notifications/:id', () => {
    it('should delete a notification successfully', async () => {
      const res = await request(app)
        .delete(`/api/v1/notifications/${notification._id}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(204);
    });

    it('should return 404 for non-existent notification', async () => {
      const fakeId = '507f1f77bcf86cd799439011';
      const res = await request(app)
        .delete(`/api/v1/notifications/${fakeId}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(404);
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app).delete(`/api/v1/notifications/${notification._id}`);
      expect(res.statusCode).toBe(401);
    });
  });

  describe('Notification Types', () => {
    it('should handle gig_application notifications', async () => {
      const gigNotification = await Notification.create({
        user: user._id,
        message: 'New application received',
        type: 'gig_application',
        isRead: false
      });

      const res = await request(app)
        .get(`/api/v1/notifications/${gigNotification._id}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.notification.type).toBe('gig_application');
    });

    it('should handle new_message notifications', async () => {
      const messageNotification = await Notification.create({
        user: user._id,
        message: 'New message received',
        type: 'new_message',
        isRead: false
      });

      const res = await request(app)
        .get(`/api/v1/notifications/${messageNotification._id}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.notification.type).toBe('new_message');
    });

    it('should handle payment notifications', async () => {
      const paymentNotification = await Notification.create({
        user: user._id,
        message: 'Payment processed successfully',
        type: 'payment',
        isRead: false
      });

      const res = await request(app)
        .get(`/api/v1/notifications/${paymentNotification._id}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.notification.type).toBe('payment');
    });
  });
}); 