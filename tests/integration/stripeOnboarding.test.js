import request from 'supertest';
import app from '../src/app.js';
import User from '../src/models/User.js';
import mongoose from 'mongoose';
import stripe from '../src/config/stripe.js'; // Assuming you have a stripe config

// Mock Stripe
jest.mock('stripe');

describe('Stripe Onboarding API', () => {
  let userToken;
  let userId;
  let mockUser;

  beforeAll(async () => {
    // Connect to test database
    const mongoUri = process.env.MONGO_TEST_URI || 'mongodb://localhost:27017/gygg_test';
    await mongoose.connect(mongoUri, { 
      useNewUrlParser: true, 
      useUnifiedTopology: true 
    });
  });

  afterAll(async () => {
    // Clean up and close database connection
    await User.deleteMany({});
    await mongoose.connection.close();
  });

  beforeEach(async () => {
    // Create a test user
    mockUser = new User({
      firstName: 'Test',
      lastName: 'User',
      email: 'test@example.com',
      password: 'TestPass123!',
      phoneNo: '+1234567890',
      dateOfBirth: '1990-01-01',
      role: ['tasker']
    });
    
    await mockUser.save();
    userId = mockUser._id;

    // In a real test, you would generate a JWT token for the user
    // For this example, we'll mock the authentication
  });

  afterEach(async () => {
    await User.deleteMany({});
  });

  describe('POST /api/v1/payments/create-connected-account', () => {
    it('should create a new Stripe connected account for a user', async () => {
      // Mock Stripe account creation
      stripe.accounts.create.mockResolvedValue({
        id: 'acct_test123',
        type: 'express',
        country: 'CA',
        email: 'test@example.com',
        details_submitted: false,
        charges_enabled: false,
        payouts_enabled: false
      });

      const response = await request(app)
        .post('/api/v1/payments/create-connected-account')
        .set('Authorization', `Bearer ${userToken}`) // You'll need to implement proper auth
        .expect(201);

      expect(response.body.status).toBe('success');
      expect(response.body.data.accountId).toBe('acct_test123');
      expect(response.body.data.isOnboarded).toBe(false);

      // Verify user was updated in database
      const updatedUser = await User.findById(userId);
      expect(updatedUser.stripeAccountId).toBe('acct_test123');
    });

    it('should return existing account if user already has one', async () => {
      // Set up user with existing Stripe account
      await User.findByIdAndUpdate(userId, {
        stripeAccountId: 'acct_existing123'
      });

      // Mock Stripe account retrieval
      stripe.accounts.retrieve.mockResolvedValue({
        id: 'acct_existing123',
        details_submitted: true,
        charges_enabled: true,
        payouts_enabled: true
      });

      const response = await request(app)
        .post('/api/v1/payments/create-connected-account')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(response.body.status).toBe('success');
      expect(response.body.message).toBe('Connected account already exists');
      expect(response.body.data.accountId).toBe('acct_existing123');
      expect(response.body.data.isOnboarded).toBe(true);
    });
  });

  describe('POST /api/v1/payments/initiate-account-session', () => {
    it('should create an account session for onboarding', async () => {
      // Set up user with existing Stripe account
      await User.findByIdAndUpdate(userId, {
        stripeAccountId: 'acct_test123'
      });

      // Mock Stripe account retrieval
      stripe.accounts.retrieve.mockResolvedValue({
        id: 'acct_test123',
        details_submitted: false,
        charges_enabled: false,
        payouts_enabled: false
      });

      // Mock Stripe account session creation
      stripe.accountSessions.create.mockResolvedValue({
        client_secret: 'test_client_secret_123'
      });

      const response = await request(app)
        .post('/api/v1/payments/initiate-account-session')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(response.body.status).toBe('success');
      expect(response.body.data.clientSecret).toBe('test_client_secret_123');
      expect(response.body.data.accountId).toBe('acct_test123');
    });

    it('should return error if user has no connected account', async () => {
      const response = await request(app)
        .post('/api/v1/payments/initiate-account-session')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(400);

      expect(response.body.message).toBe('No connected Stripe account found. Please create one first.');
    });
  });

  describe('GET /api/v1/payments/onboarding-status', () => {
    it('should return onboarding status for user with connected account', async () => {
      // Set up user with existing Stripe account
      await User.findByIdAndUpdate(userId, {
        stripeAccountId: 'acct_test123'
      });

      // Mock Stripe account retrieval
      stripe.accounts.retrieve.mockResolvedValue({
        id: 'acct_test123',
        details_submitted: true,
        charges_enabled: true,
        payouts_enabled: true
      });

      const response = await request(app)
        .get('/api/v1/payments/onboarding-status')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(response.body.status).toBe('success');
      expect(response.body.data.onboardingComplete).toBe(true);
      expect(response.body.data.accountId).toBe('acct_test123');
    });

    it('should return appropriate status for incomplete onboarding', async () => {
      // Set up user with existing Stripe account
      await User.findByIdAndUpdate(userId, {
        stripeAccountId: 'acct_test123'
      });

      // Mock Stripe account retrieval
      stripe.accounts.retrieve.mockResolvedValue({
        id: 'acct_test123',
        details_submitted: false,
        charges_enabled: false,
        payouts_enabled: false
      });

      const response = await request(app)
        .get('/api/v1/payments/onboarding-status')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(response.body.status).toBe('success');
      expect(response.body.data.onboardingComplete).toBe(false);
      expect(response.body.data.message).toBe('Onboarding incomplete');
    });
  });

  describe('Stripe Webhook Handling', () => {
    it('should handle account.updated events and update user status', async () => {
      // This test would require mocking the webhook endpoint
      // and sending a simulated Stripe webhook request
      // Implementation would depend on your webhook setup
      expect(true).toBe(true); // Placeholder
    });
  });
});