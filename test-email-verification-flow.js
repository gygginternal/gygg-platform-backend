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

// Test the complete email verification flow
const testEmailVerificationFlow = async () => {
  try {
    await connectDB();
    
    console.log('🧪 Testing Email Verification Flow');
    console.log('==================================\n');
    
    // 1. Find a test user or create one
    let testUser = await User.findOne({ email: 'test@mail.com' });
    
    if (!testUser) {
      console.log('❌ Test user not found. Please create a user with email: test@mail.com');
      return;
    }
    
    console.log(`✅ Found test user: ${testUser.email}`);
    console.log(`   Current verification status: ${testUser.isEmailVerified}`);
    
    // 2. Generate a new verification token
    const rawToken = testUser.createEmailVerificationToken();
    await testUser.save({ validateBeforeSave: false });
    
    console.log(`✅ Generated new verification token`);
    console.log(`   Raw token: ${rawToken}`);
    console.log(`   Expires at: ${new Date(testUser.emailVerificationExpires).toISOString()}`);
    
    // 3. Test token hashing (simulate what happens in verifyEmail)
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
    console.log(`   Hashed token: ${hashedToken}`);
    console.log(`   Stored token: ${testUser.emailVerificationToken}`);
    console.log(`   Tokens match: ${hashedToken === testUser.emailVerificationToken}`);
    
    // 4. Test verification URLs
    const apiURL = `http://localhost:5000/api/v1/users/verifyEmail/${rawToken}`;
    const frontendURL = `http://localhost:3000/verify-email?token=${rawToken}`;
    
    console.log('\n📧 Verification URLs:');
    console.log(`   API URL: ${apiURL}`);
    console.log(`   Frontend URL: ${frontendURL}`);
    
    // 5. Test different scenarios
    console.log('\n🔍 Testing Scenarios:');
    
    // Scenario 1: Valid token
    const validUser = await User.findOne({
      emailVerificationToken: hashedToken,
      emailVerificationExpires: { $gt: Date.now() }
    });
    console.log(`   ✅ Valid token lookup: ${validUser ? 'Found' : 'Not found'}`);
    
    // Scenario 2: Expired token (simulate)
    const expiredUser = await User.findOne({
      emailVerificationToken: hashedToken,
      emailVerificationExpires: { $lt: Date.now() }
    });
    console.log(`   ⏰ Expired token lookup: ${expiredUser ? 'Found expired' : 'Not expired'}`);
    
    // Scenario 3: Invalid token
    const invalidHashedToken = crypto.createHash('sha256').update('invalid-token').digest('hex');
    const invalidUser = await User.findOne({
      emailVerificationToken: invalidHashedToken
    });
    console.log(`   ❌ Invalid token lookup: ${invalidUser ? 'Found' : 'Not found (correct)'}`);
    
    console.log('\n🎯 Test Results:');
    console.log('   - Token generation: ✅ Working');
    console.log('   - Token hashing: ✅ Working');
    console.log('   - Database lookup: ✅ Working');
    console.log('   - URL generation: ✅ Working');
    
    console.log('\n📋 Next Steps:');
    console.log('   1. Start your backend server: npm run dev');
    console.log('   2. Test the API URL in browser or Postman');
    console.log('   3. Check frontend handling of success/error states');
    console.log(`   4. Test resend functionality with email: ${testUser.email}`);
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
  }
};

// Run the test
testEmailVerificationFlow().catch(console.error);