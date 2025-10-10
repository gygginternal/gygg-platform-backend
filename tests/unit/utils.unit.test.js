import { jest } from '@jest/globals';
import catchAsync from '../../src/utils/catchAsync.js';
import AppError from '../../src/utils/AppError.js';

describe('Utility Functions', () => {
  describe('catchAsync', () => {
    test('should handle successful async operation', async () => {
      const mockReq = {};
      const mockRes = {};
      const mockNext = jest.fn();
      
      const asyncFn = jest.fn().mockResolvedValue('success');
      const wrappedFn = catchAsync(asyncFn);
      
      await wrappedFn(mockReq, mockRes, mockNext);
      
      expect(asyncFn).toHaveBeenCalledWith(mockReq, mockRes, mockNext);
      expect(mockNext).not.toHaveBeenCalled();
    });

    test('should handle async operation with error', async () => {
      const mockReq = {};
      const mockRes = {};
      const mockNext = jest.fn();
      
      const error = new Error('Test error');
      const asyncFn = jest.fn().mockRejectedValue(error);
      const wrappedFn = catchAsync(asyncFn);
      
      await wrappedFn(mockReq, mockRes, mockNext);
      
      expect(asyncFn).toHaveBeenCalledWith(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalledWith(error);
    });

    test('should handle async operation with AppError', async () => {
      const mockReq = {};
      const mockRes = {};
      const mockNext = jest.fn();
      
      const appError = new AppError('Custom error', 400);
      const asyncFn = jest.fn().mockRejectedValue(appError);
      const wrappedFn = catchAsync(asyncFn);
      
      await wrappedFn(mockReq, mockRes, mockNext);
      
      expect(mockNext).toHaveBeenCalledWith(appError);
    });
  });

  describe('AppError', () => {
    test('should create AppError with message and statusCode', () => {
      const error = new AppError('Test error message', 404);
      
      expect(error.message).toBe('Test error message');
      expect(error.statusCode).toBe(404);
      expect(error.status).toBe('fail');
      expect(error.isOperational).toBe(true);
    });

    test('should have undefined statusCode if not provided', () => {
      const error = new AppError('Test error message');
      
      expect(error.statusCode).toBeUndefined();
      expect(error.status).toBe('error'); // Since undefined doesn't start with '4'
    });

    test('should set status to "fail" for 4xx errors', () => {
      const error = new AppError('Test error message', 400);
      
      expect(error.status).toBe('fail');
    });

    test('should set status to "error" for 5xx errors', () => {
      const error = new AppError('Test error message', 500);
      
      expect(error.status).toBe('error');
    });
  });
});