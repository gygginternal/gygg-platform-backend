/**
 * Enhanced security headers middleware for production
 */
export const securityHeaders = (req, res, next) => {
  // Remove server information
  res.removeHeader('X-Powered-By');
  res.removeHeader('Server');
  
  // Content Security Policy
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://js.stripe.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https: blob:",
    "connect-src 'self' https://api.stripe.com",
    "frame-src https://js.stripe.com https://hooks.stripe.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ].join('; ');
  
  res.setHeader('Content-Security-Policy', csp);
  
  // Additional security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');
  
  // HSTS (HTTP Strict Transport Security) - only in production with HTTPS
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
  
  // Prevent caching of sensitive data
  const sensitiveRoutes = [
    '/api/v1/users/me',
    '/api/v1/payments',
    '/api/v1/chat',
    '/api/v1/contracts',
    '/api/v1/notifications'
  ];
  
  if (sensitiveRoutes.some(route => req.path.includes(route))) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  
  // Add security headers for API responses
  res.setHeader('X-API-Version', '1.0');
  res.setHeader('X-Request-ID', req.id || 'unknown');
  
  next();
};

/**
 * CSRF protection middleware
 */
export const csrfProtection = (req, res, next) => {
  // Skip CSRF for GET, HEAD, OPTIONS requests
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }
  
  // Skip CSRF for webhook endpoints
  if (req.path.includes('/webhook')) {
    return next();
  }
  
  // Check for CSRF token in header
  const token = req.headers['x-csrf-token'] || req.headers['x-xsrf-token'];
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  
  // Validate origin/referer for same-origin requests
  const allowedOrigins = [
    process.env.FRONTEND_URL,
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:3001'
  ].filter(Boolean);
  
  const isValidOrigin = origin && allowedOrigins.includes(origin);
  const isValidReferer = referer && allowedOrigins.some(allowed => referer.startsWith(allowed));
  
  if (!isValidOrigin && !isValidReferer) {
    logger.warn('CSRF protection triggered - invalid origin/referer', {
      origin,
      referer,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      path: req.path
    });
    return res.status(403).json({
      status: 'error',
      message: 'Invalid request origin'
    });
  }
  
  next();
};