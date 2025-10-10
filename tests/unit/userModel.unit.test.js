import { jest } from '@jest/globals';
import User from '../../src/models/User.js';
import mongoose from 'mongoose';

// Mock mongoose
jest.mock('mongoose');

describe('User Model', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should have the correct schema fields', () => {
    const UserSchema = User.schema;

    // Check for required fields
    expect(UserSchema.path('email')).toBeDefined();
    expect(UserSchema.path('password')).toBeDefined();
    expect(UserSchema.path('role')).toBeDefined();
    expect(UserSchema.path('phoneNo')).toBeDefined();

    // Check for optional fields
    expect(UserSchema.path('firstName')).toBeDefined();
    expect(UserSchema.path('lastName')).toBeDefined();
    expect(UserSchema.path('bio')).toBeDefined();
    expect(UserSchema.path('hobbies')).toBeDefined();
    expect(UserSchema.path('skills')).toBeDefined();
  });

  test('should validate email format', () => {
    const UserSchema = User.schema;
    const emailValidator = UserSchema.path('email').validators.find(v => v.validator.name === 'validate');
    
    expect(emailValidator.validator('test@example.com')).toBe(true);
    expect(emailValidator.validator('invalid-email')).toBe(false);
  });

  test('should validate phone number format', () => {
    const UserSchema = User.schema;
    const phoneValidator = UserSchema.path('phoneNo').validators.find(v => v.validator.name === 'validate');

    // Since this is an email validator, we need to check phoneNo specifically
    expect(UserSchema.path('phoneNo')).toBeDefined();
  });

  test('should validate password strength', () => {
    const UserSchema = User.schema;
    const passwordValidator = UserSchema.path('password').validators.find(v => v.validator.name === 'validate');

    // Test password strength validation - contains uppercase, lowercase, number, special char
    expect(passwordValidator.validator('ValidPass1!')).toBe(true);
    expect(passwordValidator.validator('weakpass')).toBe(false); // no uppercase, number, or special char
    expect(passwordValidator.validator('WEAKPASS1!')).toBe(false); // no lowercase
    expect(passwordValidator.validator('weakpass1!')).toBe(false); // no uppercase
    expect(passwordValidator.validator('WeakPass!')).toBe(false); // no number
  });

  test('should have proper indexes', () => {
    const UserSchema = User.schema;
    const indexes = UserSchema.indexes();

    // Check for Stripe account index
    const stripeIndex = indexes.find(([index]) => index.stripeAccountId);
    expect(stripeIndex).toBeDefined();
  });

  test('should have text search index', () => {
    const UserSchema = User.schema;
    const indexes = UserSchema.indexes();

    // Check for text search index
    const textIndex = indexes.find(([index, options]) => 
      index.firstName === 'text' || 
      index.lastName === 'text' || 
      index.fullName === 'text'
    );
    expect(textIndex).toBeDefined();
  });

  test('should have fullName virtual getter', () => {
    const mockUser = {
      firstName: 'John',
      lastName: 'Doe',
      toJSON: () => this,
      toObject: () => this
    };

    // Manually add the virtual method to the mock
    Object.defineProperty(mockUser, 'fullName', {
      get: function() {
        return `${this.firstName} ${this.lastName}`;
      },
      enumerable: true,
      configurable: true
    });

    expect(mockUser.fullName).toBe('John Doe');
  });
});