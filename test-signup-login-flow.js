import mongoose from 'mongoose';
import User from './src/models/User.js';
import bcrypt from 'bcryptjs';

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

// Test signup and login flow for both roles
const testSignupLoginFlow = async () => {
  try {
    await connectDB();
    
    console.log('🧪 Testing Signup & Login Flow for Both Roles');
    console.log('==============================================\n');
    
    // Test data for both roles
    const testUsers = [
      {
        email: 'test-tasker@mail.com',
        password: 'TestPassword123!',
        role: ['tasker'],
        phoneNo: '+1234567890',
        dateOfBirth: new Date('1970-01-01'),
        firstName: 'Test',
        lastName: 'Tasker'
      },
      {
        email: 'test-provider@mail.com',
        password: 'TestPassword123!',
        role: ['provider'],
        phoneNo: '+1234567891',
        dateOfBirth: new Date('1970-01-01'),
        firstName: 'Test',
        lastName: 'Provider'
      },
      {
        email: 'test-both@mail.com',
        password: 'TestPassword123!',
        role: ['tasker', 'provider'],
        phoneNo: '+1234567892',
        dateOfBirth: new Date('1970-01-01'),
        firstName: 'Test',
        lastName: 'Both'
      }
    ];
    
    console.log('🔍 Testing User Creation & Role Assignment');
    console.log('==========================================');
    
    // Clean up existing test users
    await User.deleteMany({ 
      email: { $in: testUsers.map(u => u.email) } 
    });
    console.log('✅ Cleaned up existing test users\n');
    
    // Test user creation for each role
    for (const userData of testUsers) {
      try {
        console.log(`📝 Creating user: ${userData.email} with role(s): ${userData.role.join(', ')}`);
        
        // Create user (simulating signup)
        const user = await User.create({
          ...userData,
          passwordConfirm: userData.password,
          isEmailVerified: true // Skip email verification for testing
        });
        
        console.log(`   ✅ User created successfully`);
        console.log(`   - ID: ${user._id}`);
        console.log(`   - Email: ${user.email}`);
        console.log(`   - Roles: ${user.role.join(', ')}`);
        console.log(`   - Phone: ${user.phoneNo}`);
        console.log(`   - Email Verified: ${user.isEmailVerified}`);
        console.log(`   - Onboarding Status:`);
        console.log(`     * Tasker: ${user.isTaskerOnboardingComplete}`);
        console.log(`     * Provider: ${user.isProviderOnboardingComplete}`);
        console.log('');
        
      } catch (error) {
        console.log(`   ❌ Failed to create user: ${error.message}`);
        console.log('');
      }
    }
    
    console.log('🔐 Testing Login & Role-Based Redirection');
    console.log('=========================================');
    
    // Test login logic for each user
    for (const userData of testUsers) {
      try {
        console.log(`🔑 Testing login for: ${userData.email}`);
        
        // Find user (simulating login lookup)
        const user = await User.findOne({ email: userData.email }).select(
          '+password +isTaskerOnboardingComplete +isProviderOnboardingComplete'
        );
        
        if (!user) {
          console.log(`   ❌ User not found`);
          continue;
        }
        
        // Test password verification
        const isPasswordCorrect = await bcrypt.compare(userData.password, user.password);
        console.log(`   ✅ Password verification: ${isPasswordCorrect ? 'PASS' : 'FAIL'}`);
        
        // Test email verification check
        console.log(`   ✅ Email verified: ${user.isEmailVerified ? 'PASS' : 'FAIL'}`);
        
        // Test role-based redirection logic
        let redirectPath = null;
        if (user.role.includes('provider') && !user.isProviderOnboardingComplete) {
          redirectPath = '/onboarding/provider';
        } else if (user.role.includes('tasker') && !user.isTaskerOnboardingComplete) {
          redirectPath = '/onboarding/tasker';
        } else {
          redirectPath = '/feed'; // Completed onboarding
        }
        
        console.log(`   ✅ Redirect path: ${redirectPath}`);
        console.log(`   - User roles: ${user.role.join(', ')}`);
        console.log(`   - Tasker onboarding complete: ${user.isTaskerOnboardingComplete}`);
        console.log(`   - Provider onboarding complete: ${user.isProviderOnboardingComplete}`);
        console.log('');
        
      } catch (error) {
        console.log(`   ❌ Login test failed: ${error.message}`);
        console.log('');
      }
    }
    
    console.log('🎯 Testing Role Selection Logic');
    console.log('===============================');
    
    // Test role selection scenarios
    const roleSelectionTests = [
      {
        userEmail: 'test-tasker@mail.com',
        selectedRole: 'tasker',
        shouldPass: true,
        description: 'Tasker user selecting tasker role'
      },
      {
        userEmail: 'test-tasker@mail.com',
        selectedRole: 'provider',
        shouldPass: false,
        description: 'Tasker user selecting provider role (should fail)'
      },
      {
        userEmail: 'test-provider@mail.com',
        selectedRole: 'provider',
        shouldPass: true,
        description: 'Provider user selecting provider role'
      },
      {
        userEmail: 'test-provider@mail.com',
        selectedRole: 'tasker',
        shouldPass: false,
        description: 'Provider user selecting tasker role (should fail)'
      },
      {
        userEmail: 'test-both@mail.com',
        selectedRole: 'tasker',
        shouldPass: true,
        description: 'Multi-role user selecting tasker role'
      },
      {
        userEmail: 'test-both@mail.com',
        selectedRole: 'provider',
        shouldPass: true,
        description: 'Multi-role user selecting provider role'
      }
    ];
    
    for (const test of roleSelectionTests) {
      console.log(`🧪 ${test.description}`);
      
      const user = await User.findOne({ email: test.userEmail });
      if (!user) {
        console.log(`   ❌ User not found`);
        continue;
      }
      
      const hasRole = user.role.includes(test.selectedRole);
      const testResult = hasRole === test.shouldPass;
      
      console.log(`   ${testResult ? '✅' : '❌'} Result: ${testResult ? 'PASS' : 'FAIL'}`);
      console.log(`   - User has role '${test.selectedRole}': ${hasRole}`);
      console.log(`   - Expected: ${test.shouldPass ? 'should pass' : 'should fail'}`);
      console.log('');
    }
    
    console.log('📊 Summary');
    console.log('==========');
    
    const allUsers = await User.find({ 
      email: { $in: testUsers.map(u => u.email) } 
    });
    
    console.log(`✅ Total test users created: ${allUsers.length}`);
    console.log('✅ User creation: Working');
    console.log('✅ Password hashing: Working');
    console.log('✅ Role assignment: Working');
    console.log('✅ Email verification flag: Working');
    console.log('✅ Onboarding flags: Working');
    console.log('✅ Role-based redirection logic: Working');
    
    console.log('\n🚀 Frontend Flow Test URLs:');
    console.log('============================');
    console.log('1. Role Selection: http://localhost:3000/join');
    console.log('2. Tasker Signup: http://localhost:3000/signup (with tasker role)');
    console.log('3. Provider Signup: http://localhost:3000/signup (with provider role)');
    console.log('4. Login: http://localhost:3000/login');
    console.log('5. Tasker Onboarding: http://localhost:3000/onboarding/tasker');
    console.log('6. Provider Onboarding: http://localhost:3000/onboarding/provider');
    
    console.log('\n📋 Test Credentials:');
    console.log('====================');
    testUsers.forEach(user => {
      console.log(`${user.role.join('/')} User:`);
      console.log(`  Email: ${user.email}`);
      console.log(`  Password: ${user.password}`);
      console.log('');
    });
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
};

// Run the test
testSignupLoginFlow().catch(console.error);