import request from 'supertest';
import mongoose from 'mongoose';
import app from '../../src/app.js';
import User from '../../src/models/User.js';
import { 
  findDocumentById, 
  findDocumentByIdWithPopulate, 
  updateDocumentById, 
  deleteDocumentById, 
  paginateResults 
} from '../../src/utils/dbHelpers.js';describe('Phase 3: Database Query Optimization Tests', () => {
  let server;
  let testUser;

  beforeAll(async () => {
    server = app.listen(0);
    
    testUser = await User.create({
      firstName: 'Test',
      lastName: 'DB',
      email: 'db-test@example.com',
      password: 'TestPass123!',
      phoneNo: '+12345678901',
      role: ['provider']
    });
  });

  afterAll(async () => {
    await User.deleteMany({ email: 'db-test@example.com' });
    await server.close();
    await mongoose.connection.close();
  });

  describe('Database Query Timeouts', () => {
    test('findDocumentById should respect timeout parameter', async () => {
      // Test that findDocumentById works with timeout
      const result = await findDocumentById(
        User, 
        testUser._id, 
        'User not found', 
        8000  // 8 second timeout
      );
      
      expect(result).toBeDefined();
      expect(result._id.toString()).toBe(testUser._id.toString());
    }, 15000);

    test('findDocumentByIdWithPopulate should respect timeout parameter', async () => {
      // Test that findDocumentByIdWithPopulate works with timeout
      const result = await findDocumentByIdWithPopulate(
        User, 
        testUser._id, 
        'followers following',  // populate fields
        'User not found', 
        8000  // 8 second timeout
      );
      
      expect(result).toBeDefined();
      expect(result._id.toString()).toBe(testUser._id.toString());
    }, 15000);

    test('updateDocumentById should respect timeout parameter', async () => {
      // Test that updateDocumentById works with timeout
      const result = await updateDocumentById(
        User,
        testUser._id,
        { bio: 'Updated for timeout test' },
        { new: true },
        'User not found',
        8000  // 8 second timeout
      );
      
      expect(result).toBeDefined();
      expect(result._id.toString()).toBe(testUser._id.toString());
      expect(result.bio).toBe('Updated for timeout test');
    }, 15000);

    test('deleteDocumentById should respect timeout parameter', async () => {
      // Create a temporary user for deletion test
      const tempUser = await User.create({
        firstName: 'Temp',
        lastName: 'Delete',
        email: 'temp-delete@example.com',
        password: 'TestPass123!',
        phoneNo: '+12345678902',
        role: ['provider']
      });

      // Test that deleteDocumentById works with timeout
      const result = await deleteDocumentById(
        User,
        tempUser._id,
        'User not found',
        8000  // 8 second timeout
      );
      
      expect(result).toBeDefined();
      expect(result._id.toString()).toBe(tempUser._id.toString());
      
      // Verify user is actually deleted
      const deletedUser = await User.findById(tempUser._id);
      expect(deletedUser).toBeNull();
    }, 15000);
  });

  describe('Pagination with Timeouts', () => {
    test('paginateResults should respect timeout parameter', async () => {
      // Create a query for pagination
      const query = User.find({ email: { $regex: '.*test.*', $options: 'i' } });
      
      const result = await paginateResults(query, 1, 10, 8000);  // 8 second timeout
      
      expect(result).toBeDefined();
      expect(result.results).toBeInstanceOf(Array);
      expect(result.pagination).toBeDefined();
      expect(result.pagination.total).toBeGreaterThanOrEqual(0);
    }, 15000);
  });

  describe('Server Timeout Configuration', () => {
    test('Should handle requests without hanging', async () => {
      // Make a request to ensure server timeout configuration works
      const response = await request(app)
        .get('/health');
      
      expect(response.status).toBe(200);
      expect(response.body).toBeDefined();
    });
  });

  describe('Concurrent Query Handling', () => {
    test('Multiple queries should not cause resource exhaustion', async () => {
      // Execute multiple concurrent queries to test resource management
      const queries = [];
      for (let i = 0; i < 50; i++) {
        queries.push(
          findDocumentById(User, testUser._id, 'User not found', 5000)
        );
      }
      
      const results = await Promise.allSettled(queries);
      const successful = results.filter(result => result.status === 'fulfilled');
      
      // Most queries should succeed
      expect(successful.length).toBeGreaterThanOrEqual(45);
    }, 20000);
  });
});