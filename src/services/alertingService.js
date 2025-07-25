import nodemailer from 'nodemailer';
import redisManager from '../config/redis.js';
import { logError, logSecurityEvent, SECURITY_EVENTS } from '../utils/securityLogger.js';

class AlertingService {
  constructor() {
    this.emailTransporter = null;
    this.alertThresholds = {
      failedLogins: {
        count: 5,
        window: 15 * 60 * 1000, // 15 minutes
        severity: 'medium'
      },
      rateLimitViolations: {
        count: 10,
        window: 5 * 60 * 1000, // 5 minutes
        severity: 'high'
      },
      paymentFailures: {
        count: 3,
        window: 10 * 60 * 1000, // 10 minutes
        severity: 'high'
      },
      suspiciousActivity: {
        count: 1,
        window: 60 * 1000, // 1 minute
        severity: 'critical'
      },
      databaseErrors: {
        count: 5,
        window: 5 * 60 * 1000, // 5 minutes
        severity: 'critical'
      },
      unauthorizedAccess: {
        count: 3,
        window: 5 * 60 * 1000, // 5 minutes
        severity: 'critical'
      }
    };
    
    this.alertChannels = {
      email: process.env.ALERT_EMAIL_ENABLED === 'true',
      slack: process.env.SLACK_WEBHOOK_URL ? true : false,
      webhook: process.env.ALERT_WEBHOOK_URL ? true : false,
      redis: true // Always try Redis for real-time alerts
    };

    this.initialize();
  }

  // Initialize the alerting service
  async initialize() {
    try {
      // Initialize email transporter if configured
      if (this.alertChannels.email) {
        await this.initializeEmailTransporter();
      }

      // Subscribe to Redis security alerts
      if (redisManager.isConnected) {
        await this.subscribeToRedisAlerts();
      }

      console.log('✅ Alerting service initialized');
    } catch (error) {
      console.error('❌ Failed to initialize alerting service:', error.message);
      logError(error, { action: 'alerting_service_init_failed' });
    }
  }

  // Initialize email transporter
  async initializeEmailTransporter() {
    try {
      this.emailTransporter = nodemailer.createTransporter({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      });

      // Test the connection
      await this.emailTransporter.verify();
      console.log('✅ Email transporter initialized');
    } catch (error) {
      console.warn('⚠️ Email transporter initialization failed:', error.message);
      this.alertChannels.email = false;
    }
  }

  // Subscribe to Redis security alerts
  async subscribeToRedisAlerts() {
    try {
      await redisManager.subscribeToSecurityAlerts('security_alerts', (alert) => {
        this.processAlert(alert);
      });
      console.log('✅ Subscribed to Redis security alerts');
    } catch (error) {
      console.warn('⚠️ Failed to subscribe to Redis alerts:', error.message);
    }
  }

  // Main alert processing function
  async processSecurityEvent(eventType, data) {
    try {
      const threshold = this.alertThresholds[eventType];
      if (!threshold) {
        return; // No threshold configured for this event type
      }

      // Check if we should trigger an alert
      const shouldAlert = await this.checkAlertThreshold(eventType, threshold);
      
      if (shouldAlert) {
        const alert = {
          id: this.generateAlertId(),
          type: eventType,
          severity: threshold.severity,
          timestamp: new Date().toISOString(),
          data,
          threshold: {
            count: threshold.count,
            window: threshold.window
          }
        };

        await this.triggerAlert(alert);
      }
    } catch (error) {
      logError(error, {
        action: 'process_security_event_failed',
        eventType,
        data: JSON.stringify(data).substring(0, 200)
      });
    }
  }

  // Check if alert threshold is exceeded
  async checkAlertThreshold(eventType, threshold) {
    try {
      const key = `alert_threshold:${eventType}`;
      const now = Date.now();
      const windowStart = now - threshold.window;

      if (redisManager.isConnected) {
        // Use Redis for distributed threshold checking
        const pipeline = redisManager.client.pipeline();
        
        // Remove expired entries
        pipeline.zremrangebyscore(key, 0, windowStart);
        
        // Add current event
        pipeline.zadd(key, now, `${now}-${Math.random()}`);
        
        // Count events in window
        pipeline.zcard(key);
        
        // Set expiration
        pipeline.expire(key, Math.ceil(threshold.window / 1000));

        const results = await pipeline.exec();
        const count = results[2][1];

        return count >= threshold.count;
      } else {
        // Fallback to memory-based checking (less reliable in distributed systems)
        if (!this.memoryThresholds) {
          this.memoryThresholds = new Map();
        }

        const events = this.memoryThresholds.get(eventType) || [];
        const recentEvents = events.filter(timestamp => timestamp > windowStart);
        
        recentEvents.push(now);
        this.memoryThresholds.set(eventType, recentEvents);

        return recentEvents.length >= threshold.count;
      }
    } catch (error) {
      logError(error, {
        action: 'check_alert_threshold_failed',
        eventType
      });
      return false;
    }
  }

  // Trigger alert through all configured channels
  async triggerAlert(alert) {
    try {
      console.log(`🚨 SECURITY ALERT [${alert.severity.toUpperCase()}]: ${alert.type}`);
      
      // Log the alert
      logSecurityEvent(SECURITY_EVENTS.SUSPICIOUS_ACTIVITY, {
        action: 'security_alert_triggered',
        alertId: alert.id,
        type: alert.type,
        severity: alert.severity
      });

      // Send through all configured channels
      const promises = [];

      if (this.alertChannels.email) {
        promises.push(this.sendEmailAlert(alert));
      }

      if (this.alertChannels.slack) {
        promises.push(this.sendSlackAlert(alert));
      }

      if (this.alertChannels.webhook) {
        promises.push(this.sendWebhookAlert(alert));
      }

      if (this.alertChannels.redis) {
        promises.push(this.sendRedisAlert(alert));
      }

      // Wait for all alerts to be sent
      const results = await Promise.allSettled(promises);
      
      // Log any failures
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          const channels = ['email', 'slack', 'webhook', 'redis'];
          logError(result.reason, {
            action: 'alert_channel_failed',
            channel: channels[index],
            alertId: alert.id
          });
        }
      });

    } catch (error) {
      logError(error, {
        action: 'trigger_alert_failed',
        alertId: alert.id,
        type: alert.type
      });
    }
  }

  // Send email alert
  async sendEmailAlert(alert) {
    if (!this.emailTransporter) {
      throw new Error('Email transporter not initialized');
    }

    const subject = `🚨 Security Alert [${alert.severity.toUpperCase()}]: ${alert.type}`;
    const html = this.generateEmailHTML(alert);

    const mailOptions = {
      from: process.env.ALERT_FROM_EMAIL || process.env.EMAIL_FROM,
      to: process.env.ALERT_TO_EMAIL || process.env.ADMIN_EMAIL,
      subject,
      html
    };

    await this.emailTransporter.sendMail(mailOptions);
  }

  // Send Slack alert
  async sendSlackAlert(alert) {
    const webhookUrl = process.env.SLACK_WEBHOOK_URL;
    if (!webhookUrl) {
      throw new Error('Slack webhook URL not configured');
    }

    const payload = {
      text: `🚨 Security Alert: ${alert.type}`,
      attachments: [{
        color: this.getSeverityColor(alert.severity),
        fields: [
          {
            title: 'Severity',
            value: alert.severity.toUpperCase(),
            short: true
          },
          {
            title: 'Time',
            value: alert.timestamp,
            short: true
          },
          {
            title: 'Alert ID',
            value: alert.id,
            short: true
          },
          {
            title: 'Details',
            value: JSON.stringify(alert.data, null, 2),
            short: false
          }
        ]
      }]
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Slack webhook failed: ${response.statusText}`);
    }
  }

  // Send webhook alert
  async sendWebhookAlert(alert) {
    const webhookUrl = process.env.ALERT_WEBHOOK_URL;
    if (!webhookUrl) {
      throw new Error('Alert webhook URL not configured');
    }

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': process.env.ALERT_WEBHOOK_TOKEN ? `Bearer ${process.env.ALERT_WEBHOOK_TOKEN}` : undefined
      },
      body: JSON.stringify(alert)
    });

    if (!response.ok) {
      throw new Error(`Webhook alert failed: ${response.statusText}`);
    }
  }

  // Send Redis alert for real-time processing
  async sendRedisAlert(alert) {
    await redisManager.publishSecurityAlert('security_alerts', alert);
  }

  // Generate email HTML
  generateEmailHTML(alert) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; margin: 0; padding: 20px; }
          .alert-container { max-width: 600px; margin: 0 auto; }
          .alert-header { background-color: ${this.getSeverityColor(alert.severity)}; color: white; padding: 20px; text-align: center; }
          .alert-body { background-color: #f9f9f9; padding: 20px; border: 1px solid #ddd; }
          .alert-footer { background-color: #333; color: white; padding: 10px; text-align: center; font-size: 12px; }
          .detail-row { margin: 10px 0; }
          .detail-label { font-weight: bold; display: inline-block; width: 120px; }
          .code-block { background-color: #f4f4f4; padding: 10px; border-left: 4px solid #ccc; margin: 10px 0; font-family: monospace; }
        </style>
      </head>
      <body>
        <div class="alert-container">
          <div class="alert-header">
            <h1>🚨 Security Alert</h1>
            <h2>${alert.type}</h2>
          </div>
          <div class="alert-body">
            <div class="detail-row">
              <span class="detail-label">Severity:</span>
              <strong>${alert.severity.toUpperCase()}</strong>
            </div>
            <div class="detail-row">
              <span class="detail-label">Time:</span>
              ${new Date(alert.timestamp).toLocaleString()}
            </div>
            <div class="detail-row">
              <span class="detail-label">Alert ID:</span>
              ${alert.id}
            </div>
            <div class="detail-row">
              <span class="detail-label">Threshold:</span>
              ${alert.threshold.count} events in ${Math.round(alert.threshold.window / 1000)}s
            </div>
            <div class="detail-row">
              <span class="detail-label">Details:</span>
              <div class="code-block">${JSON.stringify(alert.data, null, 2)}</div>
            </div>
          </div>
          <div class="alert-footer">
            Gig Platform Security Monitoring System
          </div>
        </div>
      </body>
      </html>
    `;
  }

  // Get color based on severity
  getSeverityColor(severity) {
    const colors = {
      low: '#36a2eb',
      medium: '#ffcd56',
      high: '#ff6384',
      critical: '#ff0000'
    };
    return colors[severity] || '#666666';
  }

  // Generate unique alert ID
  generateAlertId() {
    return `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Process incoming alert (from Redis subscription)
  async processAlert(alert) {
    try {
      console.log(`📨 Received alert: ${alert.type} [${alert.severity}]`);
      
      // Additional processing for real-time alerts
      if (alert.severity === 'critical') {
        // Immediate actions for critical alerts
        await this.handleCriticalAlert(alert);
      }

      // Store alert in database or cache for dashboard
      await this.storeAlert(alert);

    } catch (error) {
      logError(error, {
        action: 'process_alert_failed',
        alertId: alert.id
      });
    }
  }

  // Handle critical alerts with immediate actions
  async handleCriticalAlert(alert) {
    try {
      switch (alert.type) {
        case 'suspiciousActivity':
          // Could implement automatic IP blocking here
          console.log('🔒 Critical: Suspicious activity detected');
          break;
        
        case 'unauthorizedAccess':
          // Could implement automatic account locking here
          console.log('🔒 Critical: Unauthorized access attempt');
          break;
        
        case 'databaseErrors':
          // Could implement automatic failover here
          console.log('🔒 Critical: Database errors detected');
          break;
        
        default:
          console.log(`🔒 Critical alert: ${alert.type}`);
      }
    } catch (error) {
      logError(error, {
        action: 'handle_critical_alert_failed',
        alertId: alert.id,
        type: alert.type
      });
    }
  }

  // Store alert for dashboard and reporting
  async storeAlert(alert) {
    try {
      if (redisManager.isConnected) {
        // Store in Redis with TTL
        const key = `stored_alert:${alert.id}`;
        await redisManager.set(key, alert, 7 * 24 * 3600); // 7 days TTL
        
        // Add to alerts list for dashboard
        await redisManager.client.lpush('recent_alerts', JSON.stringify(alert));
        await redisManager.client.ltrim('recent_alerts', 0, 99); // Keep last 100 alerts
      }
    } catch (error) {
      logError(error, {
        action: 'store_alert_failed',
        alertId: alert.id
      });
    }
  }

  // Get recent alerts for dashboard
  async getRecentAlerts(limit = 20) {
    try {
      if (redisManager.isConnected) {
        const alerts = await redisManager.client.lrange('recent_alerts', 0, limit - 1);
        return alerts.map(alert => JSON.parse(alert));
      }
      return [];
    } catch (error) {
      logError(error, { action: 'get_recent_alerts_failed' });
      return [];
    }
  }

  // Get alert statistics
  async getAlertStats() {
    try {
      const stats = {
        total: 0,
        bySeverity: { low: 0, medium: 0, high: 0, critical: 0 },
        byType: {},
        last24Hours: 0
      };

      if (redisManager.isConnected) {
        const alerts = await this.getRecentAlerts(100);
        const last24Hours = Date.now() - (24 * 60 * 60 * 1000);

        alerts.forEach(alert => {
          stats.total++;
          stats.bySeverity[alert.severity] = (stats.bySeverity[alert.severity] || 0) + 1;
          stats.byType[alert.type] = (stats.byType[alert.type] || 0) + 1;
          
          if (new Date(alert.timestamp).getTime() > last24Hours) {
            stats.last24Hours++;
          }
        });
      }

      return stats;
    } catch (error) {
      logError(error, { action: 'get_alert_stats_failed' });
      return { total: 0, bySeverity: {}, byType: {}, last24Hours: 0 };
    }
  }

  // Health check
  async healthCheck() {
    return {
      status: 'healthy',
      channels: {
        email: this.alertChannels.email && !!this.emailTransporter,
        slack: this.alertChannels.slack,
        webhook: this.alertChannels.webhook,
        redis: this.alertChannels.redis && redisManager.isConnected
      },
      thresholds: Object.keys(this.alertThresholds).length
    };
  }
}

// Create singleton instance
const alertingService = new AlertingService();

export default alertingService;