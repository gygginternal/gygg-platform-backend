import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';

dotenv.config({ path: './.env.test' });

let mongoServer;
let request;
let app;

// Test data
export const testUsers = {
  provider: {
    firstName: 'Test',
    lastName: 'Provider',
    email: 'provider@test.com',
    password: 'password123',
    passwordConfirm: 'password123',
    role: ['provider'],
    phoneNo: '+1234567890',
    dateOfBirth: '1950-01-01',
    isEmailVerified: true
  },
  tasker: {
    firstName: 'Test',
    lastName: 'Tasker',
    email: 'tasker@test.com',
    password: 'password123',
    passwordConfirm: 'password123',
    role: ['tasker'],
    phoneNo: '+1234567891',
    dateOfBirth: '1950-01-01',
    isEmailVerified: true
  },
  admin: {
    firstName: 'Test',
    lastName: 'Admin',
    email: 'admin@test.com',
    password: 'password123',
    passwordConfirm: 'password123',
    role: ['admin'],
    phoneNo: '+1234567892',
    dateOfBirth: '1950-01-01',
    isEmailVerified: true
  }
};

export const testGig = {
  title: 'Test Gig',
  description: 'Test gig description',
  category: 'Household Services',
  cost: 50.00,
  location: {
    address: '123 Test St',
    city: 'Test City',
    state: 'Test State',
    postalCode: '12345',
    country: 'Test Country'
  },
  isRemote: false,
  deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  duration: 2.5,
  skills: ['cleaning', 'organizing']
};

export const testPost = {
  title: 'Test Post',
  content: 'Test post content',
  category: 'General',
  tags: ['test', 'example']
};

// Helper function to create JWT token
export const createToken = (userId) => {
  // Ensure userId is converted to string
  const userIdStr = userId.toString();
  return jwt.sign({ id: userIdStr }, process.env.JWT_SECRET || 'test-secret', {
    expiresIn: '1h'
  });
};

// Helper function to create authenticated request
export const authenticatedRequest = (user) => {
  const token = createToken(user._id);
  return request(app).set('Authorization', `Bearer ${token}`);
};

// Setup function
export const setupTestDB = async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  process.env.MONGO_URI = uri;
  await mongoose.connect(uri);

  // Dynamically import app and supertest after env is set
  const supertestModule = await import('supertest');
  request = supertestModule.default;
  const appModule = await import('../src/app.js');
  app = appModule.default;
};

// Cleanup function
export const cleanupTestDB = async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
};

// Global setup and teardown
beforeAll(async () => {
  await setupTestDB();
}, 20000);

afterAll(async () => {
  await cleanupTestDB();
});

// Export for use in other test files
export { request, app }; 