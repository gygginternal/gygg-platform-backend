import logger from '../utils/logger.js';

// Blocked IPs storage (in production, use Redis or database)
const blockedIPs = new Map();
const suspiciousIPs = new Map();

// Protection thresholds
const DDOS_THRESHOLD = 100; // requests per minute
const BRUTE_FORCE_THRESHOLD = 5; // failed login attempts
const SUSPICIOUS_ACTIVITY_THRESHOLD = 20; // suspicious requests per hour

// Block durations
const SHORT_BLOCK_DURATION = 300000; // 5 minutes
const MEDIUM_BLOCK_DURATION = 1800000; // 30 minutes
const LONG_BLOCK_DURATION = 3600000; // 1 hour

// Advanced DDoS detection
export const advancedDDoSDetection = (req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  const userAgent = req.get('User-Agent') || 'Unknown';
  const method = req.method;
  const url = req.url;
  const timestamp = Date.now();
  
  // Check if IP is already blocked
  if (blockedIPs.has(ip)) {
    const blockInfo = blockedIPs.get(ip);
    if (timestamp - blockInfo.timestamp < blockInfo.duration) {
      logger.warn('Blocked IP attempted access', {
        ip,
        userAgent,
        url,
        blockReason: blockInfo.reason,
        remainingTime: blockInfo.duration - (timestamp - blockInfo.timestamp)
      });
      
      return res.status(403).json({
        status: 'fail',
        message: 'Access denied due to security policy'
      });
    } else {
      // Unblock IP if block duration has expired
      blockedIPs.delete(ip);
      logger.info('IP block expired', { ip });
    }
  }
  
  // Track IP activity for analysis
  const activity = suspiciousIPs.get(ip) || {
    requests: [],
    failedLogins: [],
    suspiciousActivities: [],
    userAgentHistory: new Set()
  };
  
  // Add current request to activity log
  activity.requests.push({
    method,
    url,
    timestamp,
    userAgent
  });
  
  // Track user agents
  activity.userAgentHistory.add(userAgent);
  
  // Keep only recent activity (last hour)
  const oneHourAgo = timestamp - 3600000;
  activity.requests = activity.requests.filter(req => req.timestamp > oneHourAgo);
  activity.failedLogins = activity.failedLogins.filter(login => login.timestamp > oneHourAgo);
  activity.suspiciousActivities = activity.suspiciousActivities.filter(activity => activity.timestamp > oneHourAgo);
  
  // Update suspicious IP tracking
  suspiciousIPs.set(ip, activity);
  
  // Analyze for DDoS patterns
  const recentRequests = activity.requests.filter(
    req => timestamp - req.timestamp < 60000
  ); // Last minute
  
  if (recentRequests.length > DDOS_THRESHOLD) {
    logger.warn('DDoS attack pattern detected', {
      ip,
      requestCount: recentRequests.length,
      userAgentCount: activity.userAgentHistory.size
    });
    
    // Block IP for medium duration
    blockedIPs.set(ip, {
      timestamp,
      duration: MEDIUM_BLOCK_DURATION,
      reason: 'DDoS attack pattern detected'
    });
    
    return res.status(429).json({
      status: 'fail',
      message: 'Too many requests. Access temporarily blocked.'
    });
  }
  
  // Analyze for brute force patterns
  const recentFailedLogins = activity.failedLogins.filter(
    login => timestamp - login.timestamp < 900000
  ); // Last 15 minutes
  
  if (recentFailedLogins.length > BRUTE_FORCE_THRESHOLD) {
    logger.warn('Brute force attack detected', {
      ip,
      failedLoginCount: recentFailedLogins.length
    });
    
    // Block IP for short duration
    blockedIPs.set(ip, {
      timestamp,
      duration: SHORT_BLOCK_DURATION,
      reason: 'Brute force attack detected'
    });
    
    return res.status(429).json({
      status: 'fail',
      message: 'Too many failed login attempts. Try again later.'
    });
  }
  
  // Analyze for suspicious activity patterns
  if (activity.suspiciousActivities.length > SUSPICIOUS_ACTIVITY_THRESHOLD) {
    logger.warn('Suspicious activity pattern detected', {
      ip,
      suspiciousActivityCount: activity.suspiciousActivities.length
    });
    
    // Block IP for long duration
    blockedIPs.set(ip, {
      timestamp,
      duration: LONG_BLOCK_DURATION,
      reason: 'Suspicious activity pattern detected'
    });
    
    return res.status(403).json({
      status: 'fail',
      message: 'Suspicious activity detected. Access temporarily blocked.'
    });
  }
  
  next();
};

// Track failed login attempts
export const trackFailedLogin = (req, ip) => {
  const timestamp = Date.now();
  
  const activity = suspiciousIPs.get(ip) || {
    requests: [],
    failedLogins: [],
    suspiciousActivities: [],
    userAgentHistory: new Set()
  };
  
  activity.failedLogins.push({
    timestamp,
    userAgent: req.get('User-Agent') || 'Unknown'
  });
  
  suspiciousIPs.set(ip, activity);
};

// Track suspicious activities
export const trackSuspiciousActivity = (req, ip, reason) => {
  const timestamp = Date.now();
  
  const activity = suspiciousIPs.get(ip) || {
    requests: [],
    failedLogins: [],
    suspiciousActivities: [],
    userAgentHistory: new Set()
  };
  
  activity.suspiciousActivities.push({
    timestamp,
    reason,
    userAgent: req.get('User-Agent') || 'Unknown'
  });
  
  suspiciousIPs.set(ip, activity);
  
  logger.warn('Suspicious activity tracked', {
    ip,
    reason
  });
};

// Input validation middleware for enhanced security
export const enhancedInputValidation = (req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  const userAgent = req.get('User-Agent') || 'Unknown';
  
  // Validate request headers
  const contentLength = req.get('Content-Length');
  if (contentLength && parseInt(contentLength) > 10240) { // 10KB limit
    trackSuspiciousActivity(req, ip, 'Large Content-Length header');
    logger.warn('Large Content-Length header detected', {
      ip,
      contentLength,
      userAgent
    });
  }
  
  // Validate user agent
  if (!userAgent || userAgent.length > 500) {
    trackSuspiciousActivity(req, ip, 'Invalid User-Agent');
    logger.warn('Invalid User-Agent detected', {
      ip,
      userAgent,
      userAgentLength: userAgent.length
    });
  }
  
  // Check for suspicious headers
  const suspiciousHeaders = [
    'x-forwarded-for',
    'client-ip',
    'x-real-ip'
  ];
  
  for (const header of suspiciousHeaders) {
    const value = req.get(header);
    if (value && value.includes(',')) {
      // Multiple IPs in header might indicate proxy manipulation
      trackSuspiciousActivity(req, ip, `Multiple IPs in ${header} header`);
      logger.warn(`Multiple IPs detected in ${header} header`, {
        ip,
        header,
        value
      });
    }
  }
  
  next();
};

// Rate limit bypass detection
export const detectRateLimitBypass = (req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  const userAgent = req.get('User-Agent') || 'Unknown';
  
  // Check for rate limit bypass attempts
  const headersToCheck = [
    'x-rate-limit-bypass',
    'x-api-key',
    'authorization'
  ];
  
  for (const header of headersToCheck) {
    const value = req.get(header);
    if (value && value.toLowerCase().includes('bypass')) {
      trackSuspiciousActivity(req, ip, `Rate limit bypass attempt in ${header} header`);
      logger.warn(`Rate limit bypass attempt detected in ${header} header`, {
        ip,
        header,
        value,
        userAgent
      });
    }
  }
  
  next();
};

// Request fingerprinting for bot detection
export const requestFingerprinting = (req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  const userAgent = req.get('User-Agent') || 'Unknown';
  const acceptHeader = req.get('Accept') || '';
  const acceptEncoding = req.get('Accept-Encoding') || '';
  const acceptLanguage = req.get('Accept-Language') || '';
  
  // Create fingerprint
  const fingerprint = `${userAgent}|${acceptHeader}|${acceptEncoding}|${acceptLanguage}`;
  
  // Store fingerprint for analysis
  const activity = suspiciousIPs.get(ip) || {
    requests: [],
    failedLogins: [],
    suspiciousActivities: [],
    userAgentHistory: new Set(),
    fingerprints: new Set()
  };
  
  activity.fingerprints.add(fingerprint);
  suspiciousIPs.set(ip, activity);
  
  // Check for automated tools (bots)
  const botIndicators = [
    'bot',
    'crawler',
    'spider',
    'scraper',
    'python',
    'curl',
    'wget',
    'postman',
    'insomnia'
  ];
  
  const userAgentLower = userAgent.toLowerCase();
  if (botIndicators.some(indicator => userAgentLower.includes(indicator))) {
    logger.debug('Bot traffic detected', {
      ip,
      userAgent,
      botType: botIndicators.find(indicator => userAgentLower.includes(indicator))
    });
  }
  
  next();
};

// Get security statistics
export const getSecurityStats = () => {
  const stats = {
    blockedIPs: blockedIPs.size,
    suspiciousIPs: suspiciousIPs.size,
    totalBlocks: Array.from(blockedIPs.values()).length,
    activeBlocks: 0
  };
  
  // Count active blocks
  const now = Date.now();
  for (const [ip, blockInfo] of blockedIPs.entries()) {
    if (now - blockInfo.timestamp < blockInfo.duration) {
      stats.activeBlocks++;
    }
  }
  
  return stats;
};

// Manually block an IP
export const blockIP = (ip, duration = MEDIUM_BLOCK_DURATION, reason = 'Manual block') => {
  blockedIPs.set(ip, {
    timestamp: Date.now(),
    duration,
    reason
  });
  
  logger.info('IP manually blocked', {
    ip,
    duration,
    reason
  });
};

// Unblock an IP
export const unblockIP = (ip) => {
  if (blockedIPs.has(ip)) {
    blockedIPs.delete(ip);
    logger.info('IP manually unblocked', { ip });
    return true;
  }
  return false;
};

// Get blocked IPs
export const getBlockedIPs = () => {
  const now = Date.now();
  const activeBlocks = [];
  
  for (const [ip, blockInfo] of blockedIPs.entries()) {
    if (now - blockInfo.timestamp < blockInfo.duration) {
      activeBlocks.push({
        ip,
        ...blockInfo,
        remainingTime: blockInfo.duration - (now - blockInfo.timestamp)
      });
    }
  }
  
  return activeBlocks;
};

export default {
  advancedDDoSDetection,
  trackFailedLogin,
  trackSuspiciousActivity,
  enhancedInputValidation,
  detectRateLimitBypass,
  requestFingerprinting,
  getSecurityStats,
  blockIP,
  unblockIP,
  getBlockedIPs
};