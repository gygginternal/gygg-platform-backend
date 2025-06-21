# Gygg Platform Backend - API Test Suite

This directory contains comprehensive tests for all backend API endpoints of the Gygg Platform.

## 🏗️ Test Structure

### Core Files
- **`setup.js`** - Test environment setup, database configuration, and shared utilities
- **`run-all-tests.js`** - Script to run all tests in the correct order

### API Test Files
- **`auth.test.js`** - Authentication endpoints (signup, login, logout, password management)
- **`user.test.js`** - User management endpoints (profile, updates, matching, Stripe integration)
- **`gig.test.js`** - Gig management endpoints (CRUD operations, applications, matching)
- **`post.test.js`** - Post management endpoints (CRUD operations, likes, comments)
- **`contract.test.js`** - Contract management endpoints (creation, status updates, lifecycle)
- **`payment.test.js`** - Payment processing endpoints (Stripe integration, refunds)
- **`chat.test.js`** - Chat functionality endpoints (messages, rooms, file uploads)
- **`review.test.js`** - Review system endpoints (ratings, comments, user reviews)
- **`notification.test.js`** - Notification system endpoints (read/unread, management)

## 🚀 Running Tests

### Run All Tests
```bash
npm test
```

### Run Specific Test File
```bash
npx jest tests/auth.test.js
```

### Run Tests with Coverage
```bash
npx jest --coverage
```

### Run Tests in Watch Mode
```bash
npx jest --watch
```

### Run Tests with Verbose Output
```bash
npx jest --verbose
```

## 🧪 Test Coverage

### Authentication API (`/api/v1/users`)
- ✅ User registration with validation
- ✅ User login/logout
- ✅ Email verification
- ✅ Password updates
- ✅ JWT token management

### User Management API (`/api/v1/users`)
- ✅ Profile retrieval and updates
- ✅ User matching (provider-tasker)
- ✅ Stripe account integration
- ✅ User album management
- ✅ Public profile access

### Gig Management API (`/api/v1/gigs`)
- ✅ Gig CRUD operations
- ✅ Gig applications
- ✅ Gig matching algorithms
- ✅ Category and status filtering
- ✅ Pagination support

### Post Management API (`/api/v1/posts`)
- ✅ Post CRUD operations
- ✅ Like/unlike functionality
- ✅ Comment system
- ✅ Category filtering
- ✅ Pagination

### Contract Management API (`/api/v1/contracts`)
- ✅ Contract creation and management
- ✅ Status transitions (pending → active → completed)
- ✅ Contract acceptance/rejection
- ✅ Contract cancellation
- ✅ Contract lifecycle management

### Payment API (`/api/v1/payments`)
- ✅ Payment intent creation
- ✅ Payment processing
- ✅ Refund handling
- ✅ Payment status tracking
- ✅ Stripe webhook handling

### Chat API (`/api/v1/chat`)
- ✅ Message sending and retrieval
- ✅ Chat room management
- ✅ Message read status
- ✅ File uploads
- ✅ Real-time messaging support

### Review API (`/api/v1/reviews`)
- ✅ Review creation and management
- ✅ Rating validation
- ✅ User review aggregation
- ✅ Average rating calculation
- ✅ Review filtering

### Notification API (`/api/v1/notifications`)
- ✅ Notification creation and retrieval
- ✅ Read/unread status management
- ✅ Bulk operations (read all, clear all)
- ✅ Notification types (gig, payment, contract)
- ✅ Unread count tracking

## 🔧 Test Environment

### Database
- Uses MongoDB Memory Server for isolated testing
- Each test suite cleans up after itself
- No external database dependencies

### Authentication
- JWT token-based authentication
- Test users with different roles (provider, tasker, admin)
- Token generation utilities

### Test Data
- Predefined test users with different roles
- Sample gigs, posts, contracts, and other entities
- Realistic test scenarios

## 📊 Test Statistics

- **Total Test Files**: 10
- **Estimated Test Cases**: 200+
- **Coverage Areas**: All major API endpoints
- **Authentication Testing**: Complete
- **Validation Testing**: Comprehensive
- **Error Handling**: Thorough

## 🛠️ Test Utilities

### Helper Functions
- `createToken(userId)` - Generate JWT tokens for testing
- `authenticatedRequest(user)` - Create authenticated requests
- `setupTestDB()` - Initialize test database
- `cleanupTestDB()` - Clean up test database

### Test Data
- `testUsers` - Predefined user objects with different roles
- `testGig` - Sample gig data
- `testPost` - Sample post data

## 🔍 Test Patterns

### Authentication Testing
- Tests for both authenticated and unauthenticated access
- Role-based access control validation
- Token validation and expiration

### Validation Testing
- Input validation for all endpoints
- Error response validation
- Invalid data handling

### CRUD Operations
- Create, Read, Update, Delete operations
- Data persistence verification
- Relationship validation

### Error Handling
- 400 Bad Request responses
- 401 Unauthorized responses
- 403 Forbidden responses
- 404 Not Found responses
- 500 Internal Server Error handling

## 🚨 Common Issues

### Timeout Issues
- Tests have increased timeouts for database operations
- Use `--detectOpenHandles` flag to identify hanging connections

### Database Connection
- Each test suite manages its own database connection
- Memory server ensures test isolation

### Authentication
- JWT tokens are generated for each test
- Tokens are valid for the duration of the test

## 📝 Adding New Tests

1. Create a new test file in the `tests/` directory
2. Import the setup utilities from `setup.js`
3. Follow the existing test patterns
4. Add comprehensive test cases for all endpoints
5. Include both success and error scenarios
6. Test authentication and authorization
7. Validate input and output data

## 🎯 Best Practices

- Use descriptive test names
- Test both success and failure scenarios
- Validate response status codes and data
- Clean up test data after each test
- Use proper authentication for protected routes
- Test input validation thoroughly
- Verify database state changes
- Test pagination and filtering
- Include edge cases and error conditions

## 📈 Continuous Integration

The test suite is designed to run in CI/CD environments:
- Uses in-memory database for isolation
- No external dependencies
- Fast execution
- Comprehensive coverage
- Reliable results

## 🔗 Related Documentation

- [API Documentation](../docs/api.md)
- [Database Schema](../docs/schema.md)
- [Authentication Guide](../docs/auth.md)
- [Deployment Guide](../docs/deployment.md) 