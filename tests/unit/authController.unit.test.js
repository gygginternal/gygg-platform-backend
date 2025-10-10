import { jest } from '@jest/globals';
import { signup, login, protect } from '../../src/controllers/authController.js';
import User from '../../src/models/User.js';
import AppError from '../../src/utils/AppError.js';

// Mock dependencies
jest.mock('../../src/models/User.js');
jest.mock('jsonwebtoken', () => ({
  sign: jest.fn(() => 'fake-jwt-token'),
  verify: jest.fn(() => ({ id: 'user123' })),
}));
jest.mock('../../src/utils/logger.js', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));
jest.mock('../../src/utils/email.js', () => ({
  default: jest.fn(() => Promise.resolve()),
}));

describe('AuthController', () => {
  let req, res, next;

  beforeEach(() => {
    req = {};
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      cookie: jest.fn(),
    };
    next = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('signup', () => {
    test('should create a new user successfully', async () => {
      const mockUserData = {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
        password: 'Password123!',
        phoneNo: '+1234567890',
        dateOfBirth: '1990-01-01',
        role: ['tasker'],
        isEmailVerified: false,
        save: jest.fn().mockResolvedValue(true),
        createEmailVerificationToken: jest.fn().mockReturnValue('verification-token'),
      };

      req.body = {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
        password: 'Password123!',
        passwordConfirm: 'Password123!',
        phoneNo: '+1234567890',
        dateOfBirth: '1990-01-01',
        role: ['tasker']
      };

      User.create = jest.fn().mockResolvedValue(mockUserData);

      await signup(req, res, next);

      expect(User.create).toHaveBeenCalledWith(expect.objectContaining({
        email: 'john@example.com'
      }));
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        status: 'success',
        token: 'fake-jwt-token'
      }));
    });

    test('should handle duplicate email error', async () => {
      const duplicateKeyError = new Error();
      duplicateKeyError.code = 11000;
      duplicateKeyError.keyPattern = { email: 1 };

      req.body = {
        email: 'existing@example.com',
        password: 'Password123!',
        passwordConfirm: 'Password123!',
        phoneNo: '+1234567890',
        dateOfBirth: '1990-01-01',
        role: ['tasker']
      };

      User.create = jest.fn().mockRejectedValue(duplicateKeyError);

      await signup(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(AppError));
    });

    test('should handle duplicate phone number error', async () => {
      const duplicateKeyError = new Error();
      duplicateKeyError.code = 11000;
      duplicateKeyError.keyPattern = { phoneNo: 1 };

      req.body = {
        email: 'new@example.com',
        password: 'Password123!',
        passwordConfirm: 'Password123!',
        phoneNo: '+1234567890',
        dateOfBirth: '1990-01-01',
        role: ['tasker']
      };

      User.create = jest.fn().mockRejectedValue(duplicateKeyError);

      await signup(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(AppError));
    });
  });

  describe('login', () => {
    test('should login user successfully', async () => {
      const mockUser = {
        _id: 'user123',
        email: 'john@example.com',
        password: 'hashedPassword',
        isEmailVerified: true,
        correctPassword: jest.fn().mockResolvedValue(true),
      };

      req.body = {
        email: 'john@example.com',
        password: 'Password123!'
      };

      User.findOne = jest.fn().mockResolvedValue(mockUser);

      await login(req, res, next);

      expect(User.findOne).toHaveBeenCalledWith({ email: 'john@example.com' });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        status: 'success',
        data: expect.any(Object),
        redirectToOnboarding: null
      }));
    });

    test('should reject login for unverified email', async () => {
      const mockUser = {
        _id: 'user123',
        email: 'john@example.com',
        password: 'hashedPassword',
        isEmailVerified: false,
        correctPassword: jest.fn().mockResolvedValue(true),
      };

      req.body = {
        email: 'john@example.com',
        password: 'Password123!'
      };

      User.findOne = jest.fn().mockResolvedValue(mockUser);

      await login(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        status: 'fail',
        message: 'Please verify your email before logging in.'
      });
    });

    test('should reject login with incorrect credentials', async () => {
      const mockUser = {
        _id: 'user123',
        email: 'john@example.com',
        password: 'hashedPassword',
        isEmailVerified: true,
        correctPassword: jest.fn().mockResolvedValue(false),
      };

      req.body = {
        email: 'john@example.com',
        password: 'WrongPassword123!'
      };

      User.findOne = jest.fn().mockResolvedValue(mockUser);

      await login(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(AppError));
    });
  });

  describe('protect', () => {
    test('should allow access with valid token', async () => {
      req.headers = { authorization: 'Bearer valid-token' };
      
      const mockUser = { _id: 'user123', changedPasswordAfter: jest.fn().mockReturnValue(false) };
      User.findById = jest.fn().mockResolvedValue(mockUser);

      await protect(req, res, next);

      expect(req.user).toEqual(mockUser);
      expect(next).toHaveBeenCalled();
    });

    test('should reject access without token', async () => {
      req.headers = {};

      await protect(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(AppError));
    });
  });
});