import mongoose from 'mongoose';
import User from './src/models/User.js';
import crypto from 'crypto';

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

// Debug email verification tokens
const debugEmailVerification = async () => {
  try {
    await connectDB();
    
    // Find users with pending email verification
    const usersWithTokens = await User.find({
      emailVerificationToken: { $exists: true, $ne: null },
      isEmailVerified: false
    }).select('email emailVerificationToken emailVerificationExpires isEmailVerified');
    
    console.log('\n=== Users with Pending Email Verification ===');
    console.log(`Found ${usersWithTokens.length} users with pending verification\n`);
    
    usersWithTokens.forEach((user, index) => {
      const now = new Date();
      const expiresAt = new Date(user.emailVerificationExpires);
      const isExpired = now > expiresAt;
      
      console.log(`${index + 1}. Email: ${user.email}`);
      console.log(`   Token exists: ${!!user.emailVerificationToken}`);
      console.log(`   Expires at: ${expiresAt.toISOString()}`);
      console.log(`   Is expired: ${isExpired}`);
      console.log(`   Is verified: ${user.isEmailVerified}`);
      console.log('');
    });
    
    // Find recently verified users
    const recentlyVerified = await User.find({
      isEmailVerified: true,
      updatedAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } // Last 24 hours
    }).select('email isEmailVerified updatedAt');
    
    console.log('=== Recently Verified Users (Last 24h) ===');
    console.log(`Found ${recentlyVerified.length} recently verified users\n`);
    
    recentlyVerified.forEach((user, index) => {
      console.log(`${index + 1}. Email: ${user.email}`);
      console.log(`   Verified at: ${user.updatedAt.toISOString()}`);
      console.log('');
    });
    
  } catch (error) {
    console.error('Error debugging email verification:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
};

// Test token hashing (to verify the process works correctly)
const testTokenHashing = () => {
  console.log('\n=== Testing Token Hashing Process ===');
  
  // Simulate token generation (like in createEmailVerificationToken)
  const rawToken = crypto.randomBytes(32).toString('hex');
  const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
  
  console.log(`Raw token: ${rawToken}`);
  console.log(`Hashed token: ${hashedToken}`);
  
  // Simulate verification (like in verifyEmail)
  const testRawToken = rawToken; // This would come from the URL
  const testHashedToken = crypto.createHash('sha256').update(testRawToken).digest('hex');
  
  console.log(`\nVerification test:`);
  console.log(`Original hashed: ${hashedToken}`);
  console.log(`Re-hashed: ${testHashedToken}`);
  console.log(`Tokens match: ${hashedToken === testHashedToken}`);
};

// Run the debug functions
const main = async () => {
  console.log('🔍 Email Verification Debug Tool');
  console.log('================================\n');
  
  testTokenHashing();
  await debugEmailVerification();
};

main().catch(console.error);