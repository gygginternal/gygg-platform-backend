import mongoose from 'mongoose';
import User from './src/models/User.js';

// Connect to database
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.DATABASE_URL || 'mongodb://localhost:27017/gig-platform?replicaSet=rs0');
    console.log('Connected to MongoDB');
  } catch (error) {
    console.error('Database connection failed:', error);
    process.exit(1);
  }
};

// Clean up expired email verification tokens
const cleanupExpiredTokens = async () => {
  try {
    await connectDB();
    
    const now = new Date();
    
    // Find users with expired tokens
    const usersWithExpiredTokens = await User.find({
      emailVerificationToken: { $exists: true, $ne: null },
      emailVerificationExpires: { $lt: now },
      isEmailVerified: false
    });
    
    console.log(`Found ${usersWithExpiredTokens.length} users with expired tokens`);
    
    if (usersWithExpiredTokens.length > 0) {
      // Clear expired tokens
      const result = await User.updateMany(
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
      
      console.log(`✅ Cleaned up ${result.modifiedCount} expired tokens`);
      
      // List the affected users
      usersWithExpiredTokens.forEach((user, index) => {
        console.log(`${index + 1}. ${user.email} - token expired at ${user.emailVerificationExpires}`);
      });
      
      console.log('\n📧 These users will need to request new verification emails.');
    } else {
      console.log('✅ No expired tokens found');
    }
    
  } catch (error) {
    console.error('Error cleaning up expired tokens:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
};

console.log('🧹 Cleaning up expired email verification tokens...');
cleanupExpiredTokens().catch(console.error);