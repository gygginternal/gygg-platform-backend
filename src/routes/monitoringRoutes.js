import express from 'express';
import { authenticate, authorize } from '../middleware/authMiddleware.js';
import redisManager from '../config/redis.js';
import alertingService from '../services/alertingService.js';
import { checkDatabaseHealth } from '../config/database.js';
import catchAsync from '../utils/catchAsync.js';
import AppError from '../utils/AppError.js';

const router = express.Router();

// Middleware to ensure only admins can access monitoring endpoints
router.use(authenticate);
router.use(authorize('admin'));

/**
 * @swagger
 * /api/v1/monitoring/health:
 *   get:
 *     summary: Get comprehensive system health status
 *     tags: [Monitoring]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: System health status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                 timestamp:
 *                   type: string
 *                 services:
 *                   type: object
 */
router.get('/health', catchAsync(async (req, res) => {
  const healthChecks = await Promise.allSettled([
    checkDatabaseHealth(),
    redisManager.healthCheck(),
    alertingService.healthCheck()
  ]);

  const [dbHealth, redisHealth, alertingHealth] = healthChecks.map(result => 
    result.status === 'fulfilled' ? result.value : { status: 'error', error: result.reason.message }
  );

  const overallStatus = [dbHealth, redisHealth, alertingHealth].every(service => 
    service.status === 'healthy' || service.status === 'connected'
  ) ? 'healthy' : 'degraded';

  res.status(200).json({
    status: overallStatus,
    timestamp: new Date().toISOString(),
    services: {
      database: dbHealth,
      redis: redisHealth,
      alerting: alertingHealth
    },
    system: {
      uptime: process.uptime(),
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + ' MB'
      },
      environment: process.env.NODE_ENV
    }
  });
}));

/**
 * @swagger
 * /api/v1/monitoring/alerts:
 *   get:
 *     summary: Get recent security alerts
 *     tags: [Monitoring]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Number of alerts to retrieve
 *     responses:
 *       200:
 *         description: Recent security alerts
 */
router.get('/alerts', catchAsync(async (req, res) => {
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  
  const [alerts, stats] = await Promise.all([
    alertingService.getRecentAlerts(limit),
    alertingService.getAlertStats()
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      alerts,
      stats,
      total: alerts.length
    }
  });
}));

/**
 * @swagger
 * /api/v1/monitoring/security-events:
 *   get:
 *     summary: Get security events from Redis
 *     tags: [Monitoring]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Security events data
 */
router.get('/security-events', catchAsync(async (req, res) => {
  if (!redisManager.isConnected) {
    return next(new AppError('Redis not available for security events', 503));
  }

  // Get various security metrics from Redis
  const [
    rateLimitViolations,
    authFailures,
    suspiciousActivities
  ] = await Promise.all([
    redisManager.client.keys('rate_limit:*').then(keys => keys.length),
    redisManager.client.keys('security_event:failedLogins:*').then(keys => keys.length),
    redisManager.client.keys('security_event:suspiciousActivity:*').then(keys => keys.length)
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      rateLimitViolations,
      authFailures,
      suspiciousActivities,
      timestamp: new Date().toISOString()
    }
  });
}));

/**
 * @swagger
 * /api/v1/monitoring/performance:
 *   get:
 *     summary: Get system performance metrics
 *     tags: [Monitoring]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Performance metrics
 */
router.get('/performance', catchAsync(async (req, res) => {
  const memUsage = process.memoryUsage();
  const cpuUsage = process.cpuUsage();
  
  // Get Redis memory usage if available
  let redisMemory = null;
  if (redisManager.isConnected) {
    try {
      const info = await redisManager.client.info('memory');
      const memoryMatch = info.match(/used_memory_human:(.+)/);
      redisMemory = memoryMatch ? memoryMatch[1].trim() : null;
    } catch (error) {
      // Ignore Redis memory errors
    }
  }

  res.status(200).json({
    status: 'success',
    data: {
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: {
        rss: Math.round(memUsage.rss / 1024 / 1024) + ' MB',
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + ' MB',
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + ' MB',
        external: Math.round(memUsage.external / 1024 / 1024) + ' MB'
      },
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system
      },
      redis: {
        connected: redisManager.isConnected,
        memory: redisMemory
      }
    }
  });
}));

/**
 * @swagger
 * /api/v1/monitoring/test-alert:
 *   post:
 *     summary: Test the alerting system (admin only)
 *     tags: [Monitoring]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [test, rateLimitViolations, suspiciousActivity]
 *               severity:
 *                 type: string
 *                 enum: [low, medium, high, critical]
 *     responses:
 *       200:
 *         description: Test alert sent
 */
router.post('/test-alert', catchAsync(async (req, res) => {
  const { type = 'test', severity = 'low' } = req.body;
  
  // Only allow in development or with explicit permission
  if (process.env.NODE_ENV === 'production' && !process.env.ALLOW_TEST_ALERTS) {
    return next(new AppError('Test alerts not allowed in production', 403));
  }

  await alertingService.processSecurityEvent(type, {
    test: true,
    triggeredBy: req.user.id,
    timestamp: new Date().toISOString(),
    message: 'This is a test alert triggered manually'
  });

  res.status(200).json({
    status: 'success',
    message: 'Test alert sent successfully',
    data: {
      type,
      severity,
      triggeredBy: req.user.id
    }
  });
}));

/**
 * @swagger
 * /api/v1/monitoring/redis-info:
 *   get:
 *     summary: Get Redis connection and performance info
 *     tags: [Monitoring]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Redis information
 */
router.get('/redis-info', catchAsync(async (req, res) => {
  if (!redisManager.isConnected) {
    return res.status(200).json({
      status: 'success',
      data: {
        connected: false,
        message: 'Redis not connected'
      }
    });
  }

  try {
    const [info, keyCount] = await Promise.all([
      redisManager.client.info(),
      redisManager.client.dbsize()
    ]);

    // Parse useful info from Redis INFO command
    const lines = info.split('\r\n');
    const parsedInfo = {};
    
    lines.forEach(line => {
      if (line.includes(':') && !line.startsWith('#')) {
        const [key, value] = line.split(':');
        parsedInfo[key] = value;
      }
    });

    res.status(200).json({
      status: 'success',
      data: {
        connected: true,
        keyCount,
        version: parsedInfo.redis_version,
        uptime: parsedInfo.uptime_in_seconds,
        memory: {
          used: parsedInfo.used_memory_human,
          peak: parsedInfo.used_memory_peak_human,
          rss: parsedInfo.used_memory_rss_human
        },
        clients: {
          connected: parsedInfo.connected_clients,
          blocked: parsedInfo.blocked_clients
        },
        stats: {
          totalConnections: parsedInfo.total_connections_received,
          totalCommands: parsedInfo.total_commands_processed,
          keyspaceHits: parsedInfo.keyspace_hits,
          keyspaceMisses: parsedInfo.keyspace_misses
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Failed to get Redis info',
      error: error.message
    });
  }
}));

/**
 * @swagger
 * /api/v1/monitoring/clear-cache:
 *   post:
 *     summary: Clear Redis cache (admin only)
 *     tags: [Monitoring]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               pattern:
 *                 type: string
 *                 description: Key pattern to clear (optional)
 *     responses:
 *       200:
 *         description: Cache cleared successfully
 */
router.post('/clear-cache', catchAsync(async (req, res) => {
  if (!redisManager.isConnected) {
    return next(new AppError('Redis not available', 503));
  }

  const { pattern } = req.body;
  let clearedCount = 0;

  try {
    if (pattern) {
      // Clear specific pattern
      const keys = await redisManager.client.keys(pattern);
      if (keys.length > 0) {
        clearedCount = await redisManager.client.del(...keys);
      }
    } else {
      // Clear all cache (be careful!)
      if (process.env.NODE_ENV === 'production') {
        return next(new AppError('Full cache clear not allowed in production', 403));
      }
      await redisManager.client.flushdb();
      clearedCount = 'all';
    }

    // Log the cache clear action
    console.log(`Cache cleared by admin ${req.user.id}: ${pattern || 'all keys'}`);

    res.status(200).json({
      status: 'success',
      message: 'Cache cleared successfully',
      data: {
        clearedCount,
        pattern: pattern || 'all',
        clearedBy: req.user.id
      }
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Failed to clear cache',
      error: error.message
    });
  }
}));

export default router;