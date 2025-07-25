import jwt from 'jsonwebtoken';
import { promisify } from 'util';
import User from '../models/User.js';
import AppError from '../utils/AppError.js';
import catchAsync from '../utils/catchAsync.js';
import logger from '../utils/logger.js';
import redisManager from '../config/redis.js';
import alertingService from '../services/alertingService.js';
import { logAuthAttempt, logSecurityEvent, SECURITY_EVENTS } from '../utils/securityLogger.js';

// Enhanced token blacklist checking with Redis
const isTokenBlacklisted = async (token) => {
  try {
    // Extract JTI from token without verification (for blacklist check)
    const decoded = jwt.decode(token);
    if (!decoded || !decoded.jti) {
      return false;
    }

    // Check Redis first, then fallback to memory
    const isBlacklisted = await redisManager.isTokenBlacklisted(decoded.jti);
    return isBlacklisted;
  } catch (error) {
    logger.error('Error checking token blacklist:', error);
    return false;
  }
};

/**
 * Enhanced JWT authentication middleware with blacklist support
 */
export const authenticate = catchAsync(async (req, res, next) => {
  let token;

  // Extract token from Authorization header or cookies
  if (req.headers.authorization?.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.cookies.jwt) {
    token = req.cookies.jwt;
  }

  // Check if token exists
  if (!token || token === 'loggedout') {
    return next(new AppError('Access denied. Please log in to continue.', 401));
  }

  // Check if token is blacklisted
  const blacklisted = await isTokenBlacklisted(token);
  if (blacklisted) {
    const clientInfo = {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      tokenPrefix: token.substring(0, 10) + '...'
    };

    logger.warn('Blacklisted token used', clientInfo);
    
    // Log security event and trigger alert
    logSecurityEvent(SECURITY_EVENTS.AUTH_FAILURE, {
      reason: 'blacklisted_token_used',
      ...clientInfo
    });

    alertingService.processSecurityEvent('unauthorizedAccess', {
      type: 'blacklisted_token_used',
      ...clientInfo
    });

    return next(new AppError('Token has been invalidated. Please log in again.', 401));
  }

  try {
    // Verify token
    const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);

    // Check if user still exists
    const currentUser = await User.findById(decoded.id).select('+passwordChangedAt');
    if (!currentUser) {
      logAuthAttempt(decoded.email || 'unknown', false, req.ip, req.get('User-Agent'), 'user_not_found');
      alertingService.processSecurityEvent('unauthorizedAccess', {
        type: 'deleted_user_token',
        userId: decoded.id,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
      return next(new AppError('The user belonging to this token no longer exists.', 401));
    }

    // Check if user is active
    if (!currentUser.active) {
      logAuthAttempt(currentUser.email, false, req.ip, req.get('User-Agent'), 'account_deactivated');
      alertingService.processSecurityEvent('unauthorizedAccess', {
        type: 'deactivated_account_access',
        userId: currentUser._id,
        email: currentUser.email,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
      return next(new AppError('Your account has been deactivated. Please contact support.', 401));
    }

    // Check if password was changed after token was issued
    if (currentUser.changedPasswordAfter(decoded.iat)) {
      logAuthAttempt(currentUser.email, false, req.ip, req.get('User-Agent'), 'password_changed');
      return next(new AppError('Password was recently changed. Please log in again.', 401));
    }

    // Check if email is verified for sensitive operations
    if (req.path.includes('/payments') || req.path.includes('/contracts')) {
      if (!currentUser.isEmailVerified) {
        return next(new AppError('Please verify your email to access this feature.', 403));
      }
    }

    // Grant access to protected route
    req.user = currentUser;
    req.token = token; // Store token for potential blacklisting
    res.locals.user = currentUser;
    
    // Log successful authentication for monitoring
    logAuthAttempt(currentUser.email, true, req.ip, req.get('User-Agent'));
    
    logger.debug('User authenticated successfully', {
      userId: currentUser._id,
      email: currentUser.email,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      path: req.path
    });

    next();
  } catch (error) {
    const clientInfo = {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      path: req.path
    };

    if (error.name === 'JsonWebTokenError') {
      logAuthAttempt('unknown', false, req.ip, req.get('User-Agent'), 'invalid_token');
      alertingService.processSecurityEvent('unauthorizedAccess', {
        type: 'invalid_token',
        ...clientInfo
      });
      return next(new AppError('Invalid token. Please log in again.', 401));
    } else if (error.name === 'TokenExpiredError') {
      logAuthAttempt('unknown', false, req.ip, req.get('User-Agent'), 'token_expired');
      return next(new AppError('Your session has expired. Please log in again.', 401));
    }
    
    logger.error('Authentication error:', error);
    return next(error);
  }
});

/**
 * Authorization middleware - restricts access to specific roles
 */
export const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AppError('Authentication required.', 401));
    }

    const userRoles = req.user.role || [];
    const hasPermission = userRoles.some(role => allowedRoles.includes(role));

    if (!hasPermission) {
      const unauthorizedInfo = {
        userId: req.user._id,
        userRoles,
        requiredRoles: allowedRoles,
        path: req.path,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      };

      logger.warn('Unauthorized access attempt', unauthorizedInfo);
      
      // Log security event and trigger alert
      logSecurityEvent(SECURITY_EVENTS.AUTH_FAILURE, {
        reason: 'insufficient_permissions',
        ...unauthorizedInfo
      });

      alertingService.processSecurityEvent('unauthorizedAccess', {
        type: 'insufficient_permissions',
        ...unauthorizedInfo
      });

      return next(new AppError('You do not have permission to perform this action.', 403));
    }

    next();
  };
};

/**
 * Optional authentication - sets user if token is valid but doesn't require it
 */
export const optionalAuth = catchAsync(async (req, res, next) => {
  let token;

  if (req.headers.authorization?.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.cookies.jwt) {
    token = req.cookies.jwt;
  }

  if (!token || token === 'loggedout') {
    return next();
  }

  // Check blacklist for optional auth
  const blacklisted = await isTokenBlacklisted(token);
  if (blacklisted) {
    return next();
  }

  try {
    const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);
    const currentUser = await User.findById(decoded.id);
    
    if (currentUser && currentUser.active && !currentUser.changedPasswordAfter(decoded.iat)) {
      req.user = currentUser;
      res.locals.user = currentUser;
    }
  } catch (error) {
    // Silently fail for optional auth
    logger.debug('Optional auth failed', { error: error.message });
  }

  next();
});

/**
 * Require email verification for sensitive operations
 */
export const requireEmailVerification = (req, res, next) => {
  if (!req.user?.isEmailVerified) {
    return next(new AppError('Please verify your email address to access this feature.', 403));
  }
  next();
};

/**
 * Check if user has completed onboarding
 */
export const requireOnboarding = (userType) => {
  return (req, res, next) => {
    const user = req.user;
    
    if (userType === 'tasker' && !user.isTaskerOnboardingComplete) {
      return next(new AppError('Please complete your tasker onboarding first.', 403));
    }
    
    if (userType === 'provider' && !user.isProviderOnboardingComplete) {
      return next(new AppError('Please complete your provider onboarding first.', 403));
    }
    
    next();
  };
};