import mongoose from 'mongoose';
import { testUsers, createToken, request, app } from './setup.js';
import User from '../src/models/User.js';
import ChatMessage from '../src/models/ChatMessage.js';
import Contract from '../src/models/Contract.js';
import { Gig } from '../src/models/Gig.js';

describe('Chat API', () => {
  let user1, user2, user1Token, user2Token, contract, gig;

  beforeEach(async () => {
    await User.deleteMany({});
    await ChatMessage.deleteMany({});
    await Contract.deleteMany({});
    await Gig.deleteMany({});

    // Create test users
    user1 = await User.create(testUsers.provider);
    user2 = await User.create(testUsers.tasker);

    // Create tokens
    user1Token = createToken(user1._id);
    user2Token = createToken(user2._id);

    // Create a test gig
    gig = await Gig.create({
      title: 'Test Gig',
      description: 'Test gig description for chat testing',
      category: 'Household Services',
      cost: 50.00,
      postedBy: user1._id,
      status: 'open'
    });

    // Create a test contract
    contract = await Contract.create({
      gig: gig._id,
      provider: user1._id,
      tasker: user2._id,
      agreedCost: 50.00,
      status: 'pending_acceptance'
    });
  });

  describe('GET /api/v1/chat/conversations', () => {
    it('should get chat conversations for authenticated user', async () => {
      const res = await request(app)
        .get('/api/v1/chat/conversations')
        .set('Authorization', `Bearer ${user1Token}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app).get('/api/v1/chat/conversations');
      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /api/v1/chat/unread-count', () => {
    it('should get unread message count for authenticated user', async () => {
      const res = await request(app)
        .get('/api/v1/chat/unread-count')
        .set('Authorization', `Bearer ${user2Token}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app).get('/api/v1/chat/unread-count');
      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /api/v1/chat/history/:contractId', () => {
    it('should get chat history for a specific contract', async () => {
      const res = await request(app)
        .get(`/api/v1/chat/history/${contract._id}`)
        .set('Authorization', `Bearer ${user1Token}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app).get(`/api/v1/chat/history/${contract._id}`);
      expect(res.statusCode).toBe(401);
    });

    it('should return 404 for non-existent contract', async () => {
      const fakeId = '507f1f77bcf86cd799439011';
      const res = await request(app)
        .get(`/api/v1/chat/history/${fakeId}`)
        .set('Authorization', `Bearer ${user1Token}`);
      expect(res.statusCode).toBe(404);
    });
  });

  describe('POST /api/v1/chat/send/:contractId', () => {
    it('should send a message for a specific contract', async () => {
      const messageData = {
        message: 'Test message content',
        type: 'text'
      };

      const res = await request(app)
        .post(`/api/v1/chat/send/${contract._id}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send(messageData);

      expect(res.statusCode).toBe(201);
      expect(res.body.status).toBe('success');
    });

    it('should return 400 for empty message content', async () => {
      const messageData = {
        message: '',
        type: 'text'
      };

      const res = await request(app)
        .post(`/api/v1/chat/send/${contract._id}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send(messageData);

      expect(res.statusCode).toBe(400);
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app)
        .post(`/api/v1/chat/send/${contract._id}`)
        .send({ message: 'Test message' });

      expect(res.statusCode).toBe(401);
    });

    it('should return 404 for non-existent contract', async () => {
      const fakeId = '507f1f77bcf86cd799439011';
      const res = await request(app)
        .post(`/api/v1/chat/send/${fakeId}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ message: 'Test message' });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('POST /api/v1/chat/upload', () => {
    it('should upload a chat image successfully', async () => {
      const res = await request(app)
        .post('/api/v1/chat/upload')
        .set('Authorization', `Bearer ${user1Token}`)
        .attach('image', Buffer.from('fake image data'), 'test.jpg');

      expect(res.statusCode).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.url).toBeDefined();
    });

    it('should return 400 for no file uploaded', async () => {
      const res = await request(app)
        .post('/api/v1/chat/upload')
        .set('Authorization', `Bearer ${user1Token}`);

      expect(res.statusCode).toBe(400);
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app).post('/api/v1/chat/upload');
      expect(res.statusCode).toBe(401);
    });
  });

  describe('POST /api/v1/chat/send (direct message, no contract)', () => {
    it('should allow provider to message tasker directly', async () => {
      const messageData = {
        message: 'Direct message from provider to tasker',
        receiverId: user2._id.toString(),
        type: 'text'
      };
      const res = await request(app)
        .post('/api/v1/chat/send')
        .set('Authorization', `Bearer ${user1Token}`)
        .send(messageData);
      expect(res.statusCode).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data.message.content).toBe(messageData.message);
      expect(res.body.data.message.receiver).toBe(user2._id.toString());
    });
    it('should allow tasker to message provider directly', async () => {
      const messageData = {
        message: 'Direct message from tasker to provider',
        receiverId: user1._id.toString(),
        type: 'text'
      };
      const res = await request(app)
        .post('/api/v1/chat/send')
        .set('Authorization', `Bearer ${user2Token}`)
        .send(messageData);
      expect(res.statusCode).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data.message.content).toBe(messageData.message);
      expect(res.body.data.message.receiver).toBe(user1._id.toString());
    });
    it('should return 400 if receiverId is missing for direct message', async () => {
      const messageData = {
        message: 'Missing receiverId',
        type: 'text'
      };
      const res = await request(app)
        .post('/api/v1/chat/send')
        .set('Authorization', `Bearer ${user1Token}`)
        .send(messageData);
      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /api/v1/chat/history (direct message, no contract)', () => {
    it('should get direct message history between provider and tasker', async () => {
      // Send a direct message first
      await request(app)
        .post('/api/v1/chat/send')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ message: 'Hello tasker!', receiverId: user2._id.toString(), type: 'text' });
      const res = await request(app)
        .get(`/api/v1/chat/history?userId=${user2._id.toString()}`)
        .set('Authorization', `Bearer ${user1Token}`);
      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
      expect(Array.isArray(res.body.data.messages)).toBe(true);
    });
  });
}); 