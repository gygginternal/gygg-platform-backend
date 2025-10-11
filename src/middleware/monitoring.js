import logger from '../utils/logger.js';

// In-memory storage for monitoring data (in production, use Redis or database)
const requestCounts = new Map();
const ipActivity = new Map();
const blockedIPs = new Map();

// Monitoring intervals
const MONITORING_INTERVAL = 60000; // 1 minute
const CLEANUP_INTERVAL = 300000; // 5 minutes

// Track request statistics
export const trackRequest = (req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  const userAgent = req.get('User-Agent') || 'Unknown';
  const method = req.method;
  const url = req.url;
  const timestamp = Date.now();
  
  // Update request counts
  const ipCount = requestCounts.get(ip) || 0;
  requestCounts.set(ip, ipCount + 1);
  
  // Track IP activity
  const activity = ipActivity.get(ip) || {
    requests: [],
    firstSeen: timestamp,
    userAgent: userAgent
  };
  
  activity.requests.push({
    method,
    url,
    timestamp,
    statusCode: null
  });
  
  // Keep only last 100 requests per IP for memory efficiency
  if (activity.requests.length > 100) {
    activity.requests = activity.requests.slice(-100);
  }
  
  activity.userAgent = userAgent;
  ipActivity.set(ip, activity);
  
  // Capture response status code
  const originalSend = res.send;
  res.send = function(body) {
    // Update the last request with status code
    if (activity.requests.length > 0) {
      const lastRequest = activity.requests[activity.requests.length - 1];
      lastRequest.statusCode = res.statusCode;
    }
    return originalSend.call(this, body);
  };
  
  next();
};

// Detect suspicious activity patterns
export const detectSuspiciousActivity = (req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  const userAgent = req.get('User-Agent') || 'Unknown';
  const method = req.method;
  const url = req.url;
  
  // Check if IP is blocked
  if (blockedIPs.has(ip)) {
    const blockInfo = blockedIPs.get(ip);
    if (Date.now() - blockInfo.timestamp < blockInfo.duration) {
      logger.warn('Blocked IP attempted access', {
        ip,
        userAgent,
        url,
        blockReason: blockInfo.reason
      });
      return res.status(403).json({
        status: 'fail',
        message: 'Access denied due to suspicious activity'
      });
    } else {
      // Unblock IP if block duration has expired
      blockedIPs.delete(ip);
    }
  }
  
  // Analyze activity patterns
  const activity = ipActivity.get(ip);
  if (activity) {
    const recentRequests = activity.requests.filter(
      req => Date.now() - req.timestamp < 60000
    ); // Last minute
    
    // Check for rapid requests (potential DDoS)
    if (recentRequests.length > 50) {
      logger.warn('Potential DDoS attack detected', {
        ip,
        requestCount: recentRequests.length,
        userAgent
      });
      
      // Temporarily block IP
      blockedIPs.set(ip, {
        timestamp: Date.now(),
        duration: 300000, // 5 minutes
        reason: 'DDoS pattern detected'
      });
      
      return res.status(429).json({
        status: 'fail',
        message: 'Too many requests. Please try again later.'
      });
    }
    
    // Check for suspicious user agents
    const suspiciousAgents = [
      'bot', 'crawler', 'scraper', 'python', 'curl', 'wget'
    ];
    
    const userAgentLower = userAgent.toLowerCase();
    if (suspiciousAgents.some(agent => userAgentLower.includes(agent))) {
      logger.warn('Suspicious user agent detected', {
        ip,
        userAgent,
        url
      });
    }
  }
  
  next();
};

// Periodic monitoring and cleanup
export const startMonitoring = () => {
  // Log periodic statistics
  setInterval(() => {
    const totalIPs = ipActivity.size;
    const totalRequests = Array.from(requestCounts.values()).reduce((sum, count) => sum + count, 0);
    
    logger.info('Request monitoring statistics', {
      activeIPs: totalIPs,
      totalRequests,
      timestamp: new Date().toISOString()
    });
  }, MONITORING_INTERVAL);
  
  // Cleanup old data
  setInterval(() => {
    const now = Date.now();
    
    // Clean up old request counts
    for (const [ip, count] of requestCounts.entries()) {
      if (count < 5) { // Remove IPs with very low activity
        requestCounts.delete(ip);
      }
    }
    
    // Clean up old IP activity (older than 1 hour)
    for (const [ip, activity] of ipActivity.entries()) {
      if (now - activity.firstSeen > 3600000) {
        ipActivity.delete(ip);
      }
    }
    
    // Clean up expired blocks
    for (const [ip, blockInfo] of blockedIPs.entries()) {
      if (now - blockInfo.timestamp > blockInfo.duration) {
        blockedIPs.delete(ip);
      }
    }
  }, CLEANUP_INTERVAL);
};

// Get monitoring statistics
export const getMonitoringStats = () => {
  const stats = {
    totalUniqueIPs: ipActivity.size,
    totalRequests: Array.from(requestCounts.values()).reduce((sum, count) => sum + count, 0),
    blockedIPs: blockedIPs.size,
    topIPs: []
  };
  
  // Get top 10 most active IPs
  const sortedIPs = Array.from(requestCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  
  stats.topIPs = sortedIPs.map(([ip, count]) => ({ ip, requestCount: count }));
  
  return stats;
};

// Middleware to add security headers
export const securityHeaders = (req, res, next) => {
  // Add security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:;");
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  
  next();
};

// Rate limit monitoring
export const monitorRateLimits = (req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  const userAgent = req.get('User-Agent') || 'Unknown';
  
  // Log rate limit attempts
  logger.debug('Rate limit monitoring', {
    ip,
    userAgent,
    url: req.url,
    method: req.method
  });
  
  // Call next middleware
  next();
};

export default {
  trackRequest,
  detectSuspiciousActivity,
  startMonitoring,
  getMonitoringStats,
  securityHeaders,
  monitorRateLimits
};