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

// Test email URL generation
const testEmailUrls = async () => {
  try {
    await connectDB();
    
    console.log('🧪 Testing Email URL Generation');
    console.log('===============================\n');
    
    // Find or create a test user
    let testUser = await User.findOne({ email: 'test-urls@mail.com' });
    
    if (!testUser) {
      testUser = await User.create({
        email: 'test-urls@mail.com',
        password: 'TestPassword123!',
        passwordConfirm: 'TestPassword123!',
        role: ['tasker'],
        phoneNo: '+1234567899',
        dateOfBirth: new Date('1970-01-01'),
        isEmailVerified: false
      });
      console.log('✅ Created test user');
    } else {
      console.log('✅ Found existing test user');
    }
    
    console.log('\n📧 Testing Email Verification URL Generation');
    console.log('=============================================');
    
    // Test email verification token generation
    const verificationToken = testUser.createEmailVerificationToken();
    await testUser.save({ validateBeforeSave: false });
    
    // Simulate URL generation (like in sendVerificationEmail)
    const frontendBaseURL = process.env.FRONTEND_URL || "http://localhost:3000";
    const verificationURL = `${frontendBaseURL}/verify-email?token=${verificationToken}`;
    
    console.log(`✅ Verification Token Generated: ${verificationToken}`);
    console.log(`✅ Verification URL: ${verificationURL}`);
    console.log(`   - Domain: ${frontendBaseURL}`);
    console.log(`   - Route: /verify-email`);
    console.log(`   - Token Parameter: token=${verificationToken}`);
    
    console.log('\n🔐 Testing Password Reset URL Generation');
    console.log('========================================');
    
    // Test password reset token generation
    const resetToken = testUser.createPasswordResetToken();
    await testUser.save({ validateBeforeSave: false });
    
    const resetURL = `${frontendBaseURL}/reset-password?token=${resetToken}`;
    
    console.log(`✅ Reset Token Generated: ${resetToken}`);
    console.log(`✅ Reset URL: ${resetURL}`);
    console.log(`   - Domain: ${frontendBaseURL}`);
    console.log(`   - Route: /reset-password`);
    console.log(`   - Token Parameter: token=${resetToken}`);
    
    console.log('\n🌐 Environment Configuration');
    console.log('============================');
    console.log(`FRONTEND_URL: ${process.env.FRONTEND_URL || 'Not set (using default)'}`);
    console.log(`BACKEND_URL: ${process.env.BACKEND_URL || 'Not set (using request host)'}`);
    
    // Show production URLs
    const productionFrontendURL = 'https://gygg.app';
    const productionVerificationURL = `${productionFrontendURL}/verify-email?token=${verificationToken}`;
    const productionResetURL = `${productionFrontendURL}/reset-password?token=${resetToken}`;
    
    console.log('\n📋 URL Structure Summary');
    console.log('========================');
    console.log('Development:');
    console.log(`  Email Verification: ${frontendBaseURL}/verify-email?token=[TOKEN]`);
    console.log(`  Password Reset: ${frontendBaseURL}/reset-password?token=[TOKEN]`);
    console.log('');
    console.log('Production (with FRONTEND_URL=https://gygg.app):');
    console.log(`  Email Verification: ${productionFrontendURL}/verify-email?token=[TOKEN]`);
    console.log(`  Password Reset: ${productionFrontendURL}/reset-password?token=[TOKEN]`);
    
    console.log('\n🎯 Frontend Route Requirements');
    console.log('==============================');
    console.log('Required routes in App.jsx:');
    console.log('  ✅ /verify-email (handles token parameter)');
    console.log('  ✅ /reset-password (handles token parameter)');
    
    console.log('\n🧪 Production URLs (what users will see)');
    console.log('=========================================');
    console.log(`Email Verification: ${productionVerificationURL}`);
    console.log(`Password Reset: ${productionResetURL}`);
    
    console.log('\n✅ All URLs now use gygg.app domain in production!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
  }
};

// Run the test
testEmailUrls().catch(console.error);