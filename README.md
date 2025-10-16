# Gygg Platform Backend

Backend server for the Gygg gig economy platform built with Node.js, Express, and MongoDB.

## Project Structure

```
gygg-platform-backend/
├── src/                    # Source code
│   ├── controllers/        # Request handlers
│   ├── models/             # Database models
│   ├── routes/             # API route definitions
│   ├── middleware/         # Express middleware
│   ├── utils/              # Utility functions
│   ├── config/             # Configuration files
│   ├── docs/               # API documentation
│   └── app.js, server.js   # Application entry points
├── tests/                  # Test files
│   ├── unit/               # Unit tests
│   ├── integration/        # Integration tests
│   └── setup/              # Test setup files
├── scripts/                # Utility scripts
├── docs/                   # Documentation files
├── temp/                   # Temporary files
└── ...
```

## Features

- RESTful API with comprehensive documentation
- User authentication and authorization
- Payment processing with Stripe
- Real-time chat functionality with WebSockets
- File upload with S3 integration
- Job posting and management system
- Review and rating system
- Time tracking capabilities
- Notification system
- Valkey (API-compatible with Redis) for caching and session storage

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set up Valkey (key-value store):
   ```bash
   # Make sure Docker is running, then start Valkey container
   docker run -d --name valkey-local -p 6380:6379 valkey/valkey:8.1.4
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env
   # Edit .env with your configuration (ensure VALKEY_PORT=6380)
   ```

4. Start the development server:
   ```bash
   npm run dev
   ```

## Scripts

- `npm start` - Start the production server
- `npm run dev` - Start the development server with nodemon
- `npm test` - Run all tests
- `npm run test:stripe` - Run Stripe-specific tests

## Valkey Management

- Start Valkey: `docker run -d --name valkey-local -p 6380:6379 valkey/valkey:8.1.4`
- Stop Valkey: `docker stop valkey-local`
- Remove Valkey container: `docker rm valkey-local`
- Check Valkey status: `docker ps | grep valkey`

## API Documentation

API documentation is available at `/api-docs` when the server is running.

## Environment Variables

Required environment variables are documented in `.env.example`.

## Testing

The test suite is organized into:
- Unit tests in `tests/unit/`
- Integration tests in `tests/integration/`
- Test utilities in `tests/setup/`