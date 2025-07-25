import Redis from 'ioredis';
import { logError, logSecurityEvent, SECURITY_EVENTS } from '../utils/securityLogger.js';

class RedisManager {
  constructor() {
    this.client = null;
    this.subscriber = null;
    this.publisher = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
  }

  // Initialize Redis connections
  async initialize() {
    try {
      const redisConfig = this.getRedisConfig();
      
      // Main Redis client for general operations
      this.client = new Redis(redisConfig);
      
      // Separate clients for pub/sub (recommended by Redis)
      this.subscriber = new Redis(redisConfig);
      this.publisher = new Redis(redisConfig);

      // Set up event handlers
      this.setupEventHandlers();
      
      // Test connection
      await this.testConnection();
      
      console.log('✅ Redis connected successfully');
      logSecurityEvent(SECURITY_EVENTS.DATA_ACCESS, {
        action: 'redis_connected',
        host: this.maskSensitiveInfo(process.env.REDIS_URL || 'localhost'),
        timestamp: new Date().toISOString()
      });

      this.isConnected = true;
      this.reconnectAttempts = 0;
      
      return true;
    } catch (error) {
      console.warn('⚠️ Redis connection failed, falling back to memory store:', error.message);
      logError(error, {
        action: 'redis_connection_failed',
        fallback: 'memory_store'
      });
      
      this.isConnected = false;
      return false;
    }
  }

  // Get Redis configuration
  getRedisConfig() {
    const baseConfig = {
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      keepAlive: 30000,
      connectTimeout: 10000,
      commandTimeout: 5000,
      family: 4, // IPv4
    };

    // If REDIS_URL is provided, use it
    if (process.env.REDIS_URL) {
      return {
        ...baseConfig,
        // Redis URL will be parsed automatically by ioredis
      };
    }

    // Otherwise, use individual config options
    return {
      ...baseConfig,
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
      db: parseInt(process.env.REDIS_DB) || 0,
      keyPrefix: process.env.REDIS_KEY_PREFIX || 'gig_platform:',
    };
  }

  // Set up Redis event handlers
  setupEventHandlers() {
    // Main client events
    this.client.on('connect', () => {
      console.log('📡 Redis client connected');
    });

    this.client.on('ready', () => {
      console.log('📡 Redis client ready');
      this.isConnected = true;
      this.reconnectAttempts = 0;
    });

    this.client.on('error', (error) => {
      console.error('❌ Redis client error:', error.message);
      logError(error, {
        action: 'redis_client_error',
        component: 'main_client'
      });
      this.isConnected = false;
    });

    this.client.on('close', () => {
      console.log('📡 Redis client connection closed');
      this.isConnected = false;
    });

    this.client.on('reconnecting', (delay) => {
      this.reconnectAttempts++;
      console.log(`📡 Redis client reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
      
      if (this.reconnectAttempts > this.maxReconnectAttempts) {
        console.error('❌ Max Redis reconnection attempts reached');
        logSecurityEvent(SECURITY_EVENTS.DATA_ACCESS, {
          action: 'redis_max_reconnect_attempts',
          attempts: this.reconnectAttempts
        });
      }
    });

    // Subscriber events
    this.subscriber.on('error', (error) => {
      logError(error, {
        action: 'redis_subscriber_error',
        component: 'subscriber'
      });
    });

    // Publisher events
    this.publisher.on('error', (error) => {
      logError(error, {
        action: 'redis_publisher_error',
        component: 'publisher'
      });
    });
  }

  // Test Redis connection
  async testConnection() {
    try {
      await this.client.ping();
      await this.client.set('health_check', 'ok', 'EX', 10);
      const result = await this.client.get('health_check');
      
      if (result !== 'ok') {
        throw new Error('Redis health check failed');
      }
      
      await this.client.del('health_check');
      return true;
    } catch (error) {
      throw new Error(`Redis connection test failed: ${error.message}`);
    }
  }

  // Rate limiting operations
  async incrementRateLimit(key, windowMs, maxRequests) {
    if (!this.isConnected) {
      return null; // Fall back to memory store
    }

    try {
      const pipeline = this.client.pipeline();
      const now = Date.now();
      const windowStart = now - windowMs;

      // Remove expired entries
      pipeline.zremrangebyscore(key, 0, windowStart);
      
      // Add current request
      pipeline.zadd(key, now, `${now}-${Math.random()}`);
      
      // Count requests in current window
      pipeline.zcard(key);
      
      // Set expiration
      pipeline.expire(key, Math.ceil(windowMs / 1000));

      const results = await pipeline.exec();
      const count = results[2][1]; // Get count result

      return {
        count,
        remaining: Math.max(0, maxRequests - count),
        resetTime: now + windowMs,
        exceeded: count > maxRequests
      };
    } catch (error) {
      logError(error, {
        action: 'redis_rate_limit_error',
        key: this.maskSensitiveInfo(key)
      });
      return null; // Fall back to memory store
    }
  }

  // Security event caching
  async cacheSecurityEvent(eventType, data, ttl = 3600) {
    if (!this.isConnected) return false;

    try {
      const key = `security_event:${eventType}:${Date.now()}`;
      await this.client.setex(key, ttl, JSON.stringify(data));
      return true;
    } catch (error) {
      logError(error, {
        action: 'redis_cache_security_event_error',
        eventType
      });
      return false;
    }
  }

  // JWT blacklist operations
  async blacklistToken(jti, exp) {
    if (!this.isConnected) return false;

    try {
      const key = `blacklist:${jti}`;
      const ttl = Math.max(1, Math.floor((exp * 1000 - Date.now()) / 1000));
      await this.client.setex(key, ttl, '1');
      return true;
    } catch (error) {
      logError(error, {
        action: 'redis_blacklist_token_error',
        jti: this.maskSensitiveInfo(jti)
      });
      return false;
    }
  }

  async isTokenBlacklisted(jti) {
    if (!this.isConnected) return false;

    try {
      const result = await this.client.get(`blacklist:${jti}`);
      return result === '1';
    } catch (error) {
      logError(error, {
        action: 'redis_check_blacklist_error',
        jti: this.maskSensitiveInfo(jti)
      });
      return false;
    }
  }

  // Session management
  async storeSession(sessionId, data, ttl = 86400) {
    if (!this.isConnected) return false;

    try {
      const key = `session:${sessionId}`;
      await this.client.setex(key, ttl, JSON.stringify(data));
      return true;
    } catch (error) {
      logError(error, {
        action: 'redis_store_session_error',
        sessionId: this.maskSensitiveInfo(sessionId)
      });
      return false;
    }
  }

  async getSession(sessionId) {
    if (!this.isConnected) return null;

    try {
      const key = `session:${sessionId}`;
      const data = await this.client.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      logError(error, {
        action: 'redis_get_session_error',
        sessionId: this.maskSensitiveInfo(sessionId)
      });
      return null;
    }
  }

  async deleteSession(sessionId) {
    if (!this.isConnected) return false;

    try {
      const key = `session:${sessionId}`;
      await this.client.del(key);
      return true;
    } catch (error) {
      logError(error, {
        action: 'redis_delete_session_error',
        sessionId: this.maskSensitiveInfo(sessionId)
      });
      return false;
    }
  }

  // Pub/Sub for real-time alerts
  async publishSecurityAlert(channel, alert) {
    if (!this.isConnected) return false;

    try {
      await this.publisher.publish(channel, JSON.stringify(alert));
      return true;
    } catch (error) {
      logError(error, {
        action: 'redis_publish_alert_error',
        channel
      });
      return false;
    }
  }

  async subscribeToSecurityAlerts(channel, callback) {
    if (!this.isConnected) return false;

    try {
      await this.subscriber.subscribe(channel);
      this.subscriber.on('message', (receivedChannel, message) => {
        if (receivedChannel === channel) {
          try {
            const alert = JSON.parse(message);
            callback(alert);
          } catch (error) {
            logError(error, {
              action: 'redis_parse_alert_error',
              channel: receivedChannel
            });
          }
        }
      });
      return true;
    } catch (error) {
      logError(error, {
        action: 'redis_subscribe_error',
        channel
      });
      return false;
    }
  }

  // Cache management
  async set(key, value, ttl = 3600) {
    if (!this.isConnected) return false;

    try {
      if (ttl) {
        await this.client.setex(key, ttl, JSON.stringify(value));
      } else {
        await this.client.set(key, JSON.stringify(value));
      }
      return true;
    } catch (error) {
      logError(error, {
        action: 'redis_set_error',
        key: this.maskSensitiveInfo(key)
      });
      return false;
    }
  }

  async get(key) {
    if (!this.isConnected) return null;

    try {
      const data = await this.client.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      logError(error, {
        action: 'redis_get_error',
        key: this.maskSensitiveInfo(key)
      });
      return null;
    }
  }

  async del(key) {
    if (!this.isConnected) return false;

    try {
      await this.client.del(key);
      return true;
    } catch (error) {
      logError(error, {
        action: 'redis_del_error',
        key: this.maskSensitiveInfo(key)
      });
      return false;
    }
  }

  // Health check
  async healthCheck() {
    try {
      if (!this.isConnected) {
        return {
          status: 'disconnected',
          connected: false,
          error: 'Redis not connected'
        };
      }

      const start = Date.now();
      await this.client.ping();
      const latency = Date.now() - start;

      const info = await this.client.info('memory');
      const memoryMatch = info.match(/used_memory_human:(.+)/);
      const memory = memoryMatch ? memoryMatch[1].trim() : 'unknown';

      return {
        status: 'healthy',
        connected: true,
        latency: `${latency}ms`,
        memory,
        reconnectAttempts: this.reconnectAttempts
      };
    } catch (error) {
      return {
        status: 'error',
        connected: false,
        error: error.message
      };
    }
  }

  // Utility function to mask sensitive information
  maskSensitiveInfo(str) {
    if (!str || typeof str !== 'string') return str;
    if (str.length <= 8) return '***';
    return str.substring(0, 4) + '***' + str.substring(str.length - 4);
  }

  // Graceful shutdown
  async disconnect() {
    try {
      if (this.client) {
        await this.client.quit();
      }
      if (this.subscriber) {
        await this.subscriber.quit();
      }
      if (this.publisher) {
        await this.publisher.quit();
      }
      
      console.log('📡 Redis connections closed gracefully');
      this.isConnected = false;
    } catch (error) {
      console.error('❌ Error closing Redis connections:', error.message);
    }
  }
}

// Create singleton instance
const redisManager = new RedisManager();

// Initialize Redis on module load
redisManager.initialize().catch(error => {
  console.warn('Redis initialization failed:', error.message);
});

// Graceful shutdown handling
process.on('SIGINT', async () => {
  await redisManager.disconnect();
});

process.on('SIGTERM', async () => {
  await redisManager.disconnect();
});

export default redisManager;