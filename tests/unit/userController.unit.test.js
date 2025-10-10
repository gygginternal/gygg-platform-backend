import { jest } from '@jest/globals';
import { updateMe } from '../../src/controllers/userController.js';
import User from '../../src/models/User.js';
import AppError from '../../src/utils/AppError.js';

// Mock dependencies
jest.mock('../../src/models/User.js');
jest.mock('../../src/utils/logger.js', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

describe('UserController - updateMe', () => {
  let req, res, next;

  beforeEach(() => {
    req = {
      user: { id: 'user123' },
      body: { firstName: 'John', lastName: 'Doe' },
      file: null,
    };
    
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    
    next = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('should update user successfully', async () => {
    const mockUser = {
      _id: 'user123',
      firstName: 'John',
      lastName: 'Doe',
      save: jest.fn(),
    };

    User.findById = jest.fn().mockResolvedValue(mockUser);
    User.findByIdAndUpdate = jest.fn().mockResolvedValue(mockUser);

    await updateMe(req, res, next);

    expect(User.findByIdAndUpdate).toHaveBeenCalledWith(
      'user123',
      expect.objectContaining({ firstName: 'John', lastName: 'Doe' }),
      { new: true, runValidators: true }
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      status: 'success',
      data: { user: mockUser }
    });
  });

  test('should not allow password update through updateMe', async () => {
    req.body = { password: 'newpassword123' };

    await updateMe(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'This route is not for password updates. Use /updateMyPassword.',
        statusCode: 400
      })
    );
  });

  test('should handle user not found error', async () => {
    User.findById = jest.fn().mockResolvedValue(null);

    await updateMe(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'User not found after update.'
      })
    );
  });

  test('should handle other errors', async () => {
    User.findById = jest.fn().mockRejectedValue(new Error('Database error'));

    await updateMe(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  test('should process string hobbies as array', async () => {
    req.body = { hobbies: 'reading,swimming,gaming' };
    const mockUser = { _id: 'user123', save: jest.fn() };
    User.findById = jest.fn().mockResolvedValue(mockUser);
    User.findByIdAndUpdate = jest.fn().mockResolvedValue(mockUser);

    await updateMe(req, res, next);

    expect(User.findByIdAndUpdate).toHaveBeenCalledWith(
      'user123',
      expect.objectContaining({ hobbies: ['reading', 'swimming', 'gaming'] }),
      expect.any(Object)
    );
  });

  test('should process array hobbies', async () => {
    req.body = { hobbies: ['reading', 'swimming'] };
    const mockUser = { _id: 'user123', save: jest.fn() };
    User.findById = jest.fn().mockResolvedValue(mockUser);
    User.findByIdAndUpdate = jest.fn().mockResolvedValue(mockUser);

    await updateMe(req, res, next);

    expect(User.findByIdAndUpdate).toHaveBeenCalledWith(
      'user123',
      expect.objectContaining({ hobbies: ['reading', 'swimming'] }),
      expect.any(Object)
    );
  });
});