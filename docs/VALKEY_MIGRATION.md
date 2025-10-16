# Valkey Migration Guide

This document explains how the project has been updated to use Valkey instead of Redis, while maintaining backward compatibility during the transition.

## Overview

[Valkey](https://valkey.io/) is an open-source, community-led distribution of Redis. It maintains 100% API compatibility with Redis, allowing for a seamless transition.

## Environment Variables

### New Valkey Variables
- `VALKEY_HOST` - The Valkey server hostname
- `VALKEY_PORT` - The Valkey server port (default: 6379)
- `VALKEY_TTL` - Default TTL for cached items (default: 300 seconds)
- `VALKEY_USER_TTL` - Default TTL for user-specific cached items (default: 600 seconds)

### Backward Compatibility
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_TTL`, `REDIS_USER_TTL` are maintained for backward compatibility
- The application will first look for `VALKEY_*` variables, then fall back to `REDIS_*` variables

## Configuration Files Updated

- `.env.example` - Added Valkey variables with backward compatibility
- `.env` - Updated to use Valkey variables with backward compatibility
- `src/config/redis.js` - Updated to use Valkey environment variables with fallback
- `src/utils/cache.js` - Updated to use Valkey environment variables with fallback
- `scripts/test-scripts/test-redis.js` - Updated to work with Valkey (using Redis client)
- `scripts/test-scripts/test-redis-simple.js` - Updated to work with Valkey (using Redis client)

## Code Changes

### Client Creation
The Redis client is now configured to use either Valkey or Redis environment variables:
```javascript
const redisClient = redis.createClient({
  socket: {
    host: process.env.VALKEY_HOST || process.env.REDIS_HOST,
    port: parseInt(process.env.VALKEY_PORT || process.env.REDIS_PORT) || 6379,
  },
});
```

### TTL Configuration
All TTL configuration now supports both Valkey and Redis environment variables:
```javascript
ttl = parseInt(process.env.VALKEY_TTL || process.env.REDIS_TTL || '300')
```

## Migration Steps

1. Update your AWS ElastiCache to use Valkey instead of Redis
2. Update the `VALKEY_HOST` and `VALKEY_PORT` in your environment variables
3. Test your application to ensure it connects properly
4. Monitor logs for "Connected to Valkey successfully" message

## Testing

To test Valkey connectivity, you can run the test scripts:
```bash
node -r dotenv/config scripts/test-scripts/test-redis.js
node -r dotenv/config scripts/test-scripts/test-redis-simple.js
```