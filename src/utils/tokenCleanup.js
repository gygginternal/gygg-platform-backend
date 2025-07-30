import User from '../models/User.js';
import logger from './logger.js';

/**
 * Cleans up expired email verification and password reset tokens
 * This should be run periodically (e.g., every hour)
 */
export const cleanupExpiredTokens = async () => {
  try {
    const now = new Date();
    
    // Clean up expired email verification tokens
    const emailTokenCleanup = await User.updateMany(
      {
        emailVerificationToken: { $exists: true, $ne: null },
        emailVerificationExpires: { $lt: now },
        isEmailVerified: false
      },
      {
        $unset: {
          emailVerificationToken: 1,
          emailVerificationExpires: 1
        }
      }
    );
    
    // Clean up expired password reset tokens
    const passwordTokenCleanup = await User.updateMany(
      {
        passwordResetToken: { $exists: true, $ne: null },
        passwordResetExpires: { $lt: now }
      },
      {
        $unset: {
          passwordResetToken: 1,
          passwordResetExpires: 1
        }
      }
    );
    
    if (emailTokenCleanup.modifiedCount > 0 || passwordTokenCleanup.modifiedCount > 0) {
      logger.info('Token cleanup completed', {
        expiredEmailTokens: emailTokenCleanup.modifiedCount,
        expiredPasswordTokens: passwordTokenCleanup.modifiedCount
      });
    }
    
    return {
      emailTokensCleared: emailTokenCleanup.modifiedCount,
      passwordTokensCleared: passwordTokenCleanup.modifiedCount
    };
    
  } catch (error) {
    logger.error('Error during token cleanup:', error);
    throw error;
  }
};

/**
 * Starts the token cleanup job that runs every hour
 */
export const startTokenCleanupJob = () => {
  // Run cleanup immediately
  cleanupExpiredTokens().catch(error => {
    logger.error('Initial token cleanup failed:', error);
  });
  
  // Then run every hour (3600000 ms)
  setInterval(() => {
    cleanupExpiredTokens().catch(error => {
      logger.error('Scheduled token cleanup failed:', error);
    });
  }, 3600000); // 1 hour
  
  logger.info('Token cleanup job started - running every hour');
};