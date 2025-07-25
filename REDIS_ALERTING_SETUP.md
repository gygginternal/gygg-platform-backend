# Redis & Monitoring Alerts Setup Guide

## 🚀 Quick Start

### 1. Install Redis Dependencies

```bash
npm install ioredis rate-limit-redis
```

### 2. Configure Environment Variables

Add these to your `.env` file:

```env
# Redis Configuration (Optional - for distributed rate limiting)
REDIS_URL=redis://localhost:6379
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
REDIS_KEY_PREFIX=gig_platform:

# Alerting Configuration
ALERT_EMAIL_ENABLED=true
ALERT_FROM_EMAIL=alerts@yourapp.com
ALERT_TO_EMAIL=admin@yourapp.com
ADMIN_EMAIL=admin@yourapp.com

# Slack Alerting (Optional)
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK

# Custom Webhook Alerting (Optional)
ALERT_WEBHOOK_URL=https://your-monitoring-service.com/webhook
ALERT_WEBHOOK_TOKEN=your-webhook-token

# Email Configuration (Required for alerts)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
```

### 3. Install and Start Redis (Optional)

#### Using Docker:
```bash
docker run -d --name redis -p 6379:6379 redis:alpine
```

#### Using Homebrew (macOS):
```bash
brew install redis
brew services start redis
```

#### Using apt (Ubuntu/Debian):
```bash
sudo apt update
sudo apt install redis-server
sudo systemctl start redis-server
```

### 4. Start the Application

```bash
npm run dev
```

## 📊 Features Implemented

### ✅ Redis Integration

- **Distributed Rate Limiting**: Uses Redis for rate limiting across multiple server instances
- **JWT Blacklisting**: Stores invalidated tokens in Redis
- **Session Management**: Optional Redis-based session storage
- **Security Event Caching**: Caches security events for analysis
- **Real-time Alerts**: Pub/Sub for real-time security alerts

### ✅ Monitoring & Alerting

- **Email Alerts**: Sends security alerts via email
- **Slack Integration**: Posts alerts to Slack channels
- **Webhook Alerts**: Sends alerts to custom webhook endpoints
- **Real-time Processing**: Redis pub/sub for immediate alert processing
- **Alert Thresholds**: Configurable thresholds for different event types

### ✅ Security Events Monitored

1. **Failed Login Attempts** (5 in 15 minutes → Medium alert)
2. **Rate Limit Violations** (10 in 5 minutes → High alert)
3. **Payment Failures** (3 in 10 minutes → High alert)
4. **Suspicious Activity** (1 occurrence → Critical alert)
5. **Database Errors** (5 in 5 minutes → Critical alert)
6. **Unauthorized Access** (3 in 5 minutes → Critical alert)

## 🔧 Configuration Options

### Redis Configuration

```javascript
// Automatic fallback to memory store if Redis unavailable
const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD,
  db: process.env.REDIS_DB || 0,
  keyPrefix: process.env.REDIS_KEY_PREFIX || 'gig_platform:',
  retryDelayOnFailover: 100,
  maxRetriesPerRequest: 3,
  lazyConnect: true
};
```

### Alert Thresholds

```javascript
const alertThresholds = {
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
  suspiciousActivity: {
    count: 1,
    window: 60 * 1000, // 1 minute
    severity: 'critical'
  }
};
```

## 📈 Monitoring Endpoints

### Health Check
```
GET /health
```
Basic application health status

### Comprehensive Health
```
GET /api/v1/monitoring/health
```
Detailed health status of all services (Admin only)

### Recent Alerts
```
GET /api/v1/monitoring/alerts?limit=20
```
Get recent security alerts (Admin only)

### Security Events
```
GET /api/v1/monitoring/security-events
```
Get security event statistics (Admin only)

### Performance Metrics
```
GET /api/v1/monitoring/performance
```
System performance metrics (Admin only)

### Redis Information
```
GET /api/v1/monitoring/redis-info
```
Redis connection and performance info (Admin only)

## 🧪 Testing

### Test Security Audit
```bash
npm run security:audit
```

### Test Alert System
```bash
npm run security:test-alert
```

### Check Redis Health
```bash
npm run redis:health
```

### Monitor Logs
```bash
# Security logs
npm run logs:security

# Error logs
npm run logs:error
```

### Test Alert via API (Development only)
```bash
curl -X POST http://localhost:5000/api/v1/monitoring/test-alert \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -d '{"type": "test", "severity": "medium"}'
```

## 🔐 Security Features

### Rate Limiting Enhancements

- **Endpoint-specific limits**: Different limits for auth, payments, uploads
- **Progressive limiting**: Increased restrictions for repeat offenders
- **Burst protection**: Very short-term rate limiting
- **Redis-backed**: Distributed rate limiting across instances

### JWT Security

- **Token blacklisting**: Invalidated tokens stored in Redis
- **Automatic cleanup**: Expired blacklist entries removed automatically
- **Distributed checking**: Works across multiple server instances

### Real-time Monitoring

- **Security event logging**: All security events logged with context
- **Suspicious activity detection**: Pattern-based detection
- **Immediate alerting**: Critical events trigger immediate alerts
- **Audit trail**: Complete audit log for compliance

## 🚨 Alert Types

### Email Alerts
- HTML formatted emails with detailed information
- Severity-based color coding
- Complete event context and recommendations

### Slack Alerts
- Rich message formatting with attachments
- Color-coded based on severity
- Direct links to monitoring dashboard

### Webhook Alerts
- JSON payload with complete event data
- Configurable authentication
- Retry logic for failed deliveries

## 📊 Dashboard Integration

### Alert Statistics
```javascript
const stats = await alertingService.getAlertStats();
// Returns: { total, bySeverity, byType, last24Hours }
```

### Recent Alerts
```javascript
const alerts = await alertingService.getRecentAlerts(20);
// Returns array of recent alerts with full context
```

### Health Status
```javascript
const health = await checkServicesHealth();
// Returns comprehensive health status
```

## 🔧 Troubleshooting

### Redis Connection Issues

1. **Check Redis is running**:
   ```bash
   redis-cli ping
   ```

2. **Check connection string**:
   ```bash
   npm run redis:health
   ```

3. **Fallback behavior**: App continues with memory store if Redis unavailable

### Alert Delivery Issues

1. **Check email configuration**:
   - Verify SMTP settings
   - Test with a simple email client

2. **Check Slack webhook**:
   - Verify webhook URL is correct
   - Test webhook manually

3. **Check logs**:
   ```bash
   npm run logs:error
   ```

### Performance Issues

1. **Monitor Redis memory**:
   ```bash
   curl -H "Authorization: Bearer TOKEN" http://localhost:5000/api/v1/monitoring/redis-info
   ```

2. **Check rate limiting**:
   - Monitor rate limit violations
   - Adjust thresholds if needed

3. **Database performance**:
   - Check slow query logs
   - Monitor connection pool

## 🚀 Production Deployment

### Environment Setup

1. **Redis Production Setup**:
   - Use Redis Cluster for high availability
   - Configure persistence (RDB + AOF)
   - Set up monitoring (Redis Sentinel)

2. **Alert Configuration**:
   - Configure production email settings
   - Set up Slack channels for different severities
   - Configure webhook endpoints for monitoring tools

3. **Security Hardening**:
   - Use Redis AUTH
   - Configure Redis over TLS
   - Restrict Redis network access

### Monitoring Setup

1. **Log Aggregation**:
   - Use ELK stack or similar for log analysis
   - Set up log rotation
   - Configure log shipping

2. **Metrics Collection**:
   - Use Prometheus + Grafana
   - Monitor Redis metrics
   - Set up custom dashboards

3. **Alerting Integration**:
   - Integrate with PagerDuty/OpsGenie
   - Set up escalation policies
   - Configure alert suppression rules

## 📝 Maintenance

### Regular Tasks

1. **Weekly**:
   - Review security logs
   - Check alert statistics
   - Verify Redis performance

2. **Monthly**:
   - Update alert thresholds based on patterns
   - Review and tune rate limits
   - Clean up old security events

3. **Quarterly**:
   - Security audit and penetration testing
   - Review and update alert configurations
   - Performance optimization

### Backup and Recovery

1. **Redis Backup**:
   - Configure automatic RDB snapshots
   - Set up AOF for point-in-time recovery
   - Test backup restoration procedures

2. **Configuration Backup**:
   - Version control all configuration files
   - Document environment variables
   - Maintain deployment runbooks

## 🎯 Next Steps

1. **Enhanced Monitoring**:
   - Add custom metrics collection
   - Implement distributed tracing
   - Set up synthetic monitoring

2. **Advanced Security**:
   - Implement anomaly detection
   - Add machine learning for threat detection
   - Integrate with SIEM systems

3. **Scalability**:
   - Implement Redis Cluster
   - Add horizontal scaling support
   - Optimize for high-throughput scenarios

---

## 📞 Support

For issues or questions:
1. Check the troubleshooting section above
2. Review application logs
3. Test individual components
4. Contact the development team

**Status**: ✅ Production Ready
**Last Updated**: $(date)
**Version**: 1.0.0