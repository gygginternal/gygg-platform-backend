import request from 'supertest';
import app from '../src/app.js';
import mongoose from 'mongoose';
import User from '../src/models/User.js';
import Contract from '../src/models/Contract.js';
import { Gig } from '../src/models/Gig.js';
import NuveiPayment from '../src/models/NuveiPayment.js';
import jwt from 'jsonwebtoken';

// Test configuration
const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-key-minimum-32-characters';

// Create test users
const testProvider = {
  firstName: 'Test',
  lastName: 'Provider',
  email: 'testprovider@example.com',
  password: 'Password123!',
  role: ['provider'],
  phoneNo: '+1234567890',
  dateOfBirth: '1980-01-01',
  isEmailVerified: true,
  nuveiAccountId: 'nuv_test_provider',
  nuveiCustomerId: 'cust_test_provider',
  nuveiBankTransferEnabled: true,
  nuveiBankDetails: {
    accountNumber: '123456789',
    institutionNumber: '001',
    transitNumber: '12345',
    accountType: 'checking'
  }
};

const testTasker = {
  firstName: 'Test',
  lastName: 'Tasker',
  email: 'testtasker@example.com',
  password: 'Password123!',
  role: ['tasker'],
  phoneNo: '+1234567891',
  dateOfBirth: '1980-01-01',
  isEmailVerified: true,
  nuveiAccountId: 'nuv_test_tasker',
  nuveiCustomerId: 'cust_test_tasker',
  nuveiBankTransferEnabled: true,
  nuveiBankDetails: {
    accountNumber: '987654321',
    institutionNumber: '002',
    transitNumber: '54321',
    accountType: 'checking'
  }
};

// Create JWT token
const createToken = (userId) => {
  return jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: '7d' });
};

const runNuveiTest = async () => {
  console.log('Starting Nuvei SimplyConnect Challenge 3D 2.0 Test...');
  
  try {
    // Connect to test database
    await mongoose.connect(process.env.DATABASE_URL || 'mongodb://localhost:27017/gygg-platform-test');
    
    // Clear test data
    await User.deleteMany({ email: { $in: ['testprovider@example.com', 'testtasker@example.com'] } });
    await Gig.deleteMany({ title: 'Test Gig for Nuvei SimplyConnect' });
    await Contract.deleteMany({ amount: 100.00 });
    await NuveiPayment.deleteMany({ amount: 10000 });

    // Create test users
    console.log('Creating test users...');
    const provider = await User.create(testProvider);
    const tasker = await User.create(testTasker);
    
    const providerToken = createToken(provider._id);
    const taskerToken = createToken(tasker._id);
    
    // Create test gig
    console.log('Creating test gig...');
    const gig = await Gig.create({
      title: 'Test Gig for Nuvei SimplyConnect',
      description: 'Test gig for SimplyConnect Challenge 3D 2.0 transaction',
      category: 'Household Services',
      cost: 100.00,
      location: {
        address: '123 Test St',
        city: 'Test City',
        state: 'Test State',
        postalCode: '12345',
        country: 'Test Country'
      },
      isRemote: false,
      deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      duration: 2.0,
      skills: ['testing', 'integration'],
      postedBy: provider._id
    });
    
    // Create test contract
    console.log('Creating test contract...');
    const contract = await Contract.create({
      gig: gig._id,
      provider: provider._id,
      tasker: tasker._id,
      status: 'active',
      amount: 100.00,
      agreedCost: 100.00
    });
    
    console.log('Test data created successfully.');
    
    // Test 1: Create Nuvei payment session (Step 1 - SimplyConnect Request)
    console.log('\nStep 1: Creating Nuvei payment session (SimplyConnect Request)...');
    const createSessionResponse = await request(app)
      .post('/api/v1/payments/nuvei/create-session')
      .set('Authorization', `Bearer ${providerToken}`)
      .send({
        contractId: contract._id.toString(),
        paymentMethod: 'card'
      });
    
    console.log('Create Session Response Status:', createSessionResponse.status);
    console.log('Create Session Response Body:', JSON.stringify(createSessionResponse.body, null, 2));
    
    if (createSessionResponse.status === 200) {
      console.log('✅ Successfully created Nuvei payment session');
      
      const { data: sessionData } = createSessionResponse.body;
      const sessionId = sessionData.sessionId;
      
      if (sessionId) {
        console.log(`✅ Session ID: ${sessionId}`);
        
        // Test 2: Get payment session details
        console.log('\nStep 2: Getting payment session details...');
        const getSessionResponse = await request(app)
          .get(`/api/v1/payments/nuvei/session/${sessionId}`)
          .set('Authorization', `Bearer ${providerToken}`);
        
        console.log('Get Session Response Status:', getSessionResponse.status);
        console.log('Get Session Response Body:', JSON.stringify(getSessionResponse.body, null, 2));
      }
    } else {
      console.log('❌ Failed to create Nuvei payment session');
      console.error('Error:', createSessionResponse.body);
    }
    
    // Additional test: Try to run the specific Nuvei integration test we saw earlier
    console.log('\nRunning additional Nuvei integration tests...');
    
    // Test 3: Nuvei withdrawal test
    console.log('Testing Nuvei withdrawal functionality...');
    const withdrawalResponse = await request(app)
      .post('/api/v1/payments/nuvei/withdraw')
      .set('Authorization', `Bearer ${taskerToken}`)
      .send({ amount: 25.00 });
    
    console.log('Withdrawal Response Status:', withdrawalResponse.status);
    console.log('Withdrawal Response Body:', JSON.stringify(withdrawalResponse.body, null, 2));
    
    // Test 4: Nuvei onboarding test
    console.log('\nTesting Nuvei onboarding functionality...');
    const onboardingResponse = await request(app)
      .post('/api/v1/payments/nuvei/start-onboarding')
      .set('Authorization', `Bearer ${taskerToken}`);
    
    console.log('Onboarding Response Status:', onboardingResponse.status);
    console.log('Onboarding Response Body:', JSON.stringify(onboardingResponse.body, null, 2));
    
    // Test 5: Check unified payment history
    console.log('\nTesting unified payment history...');
    const historyResponse = await request(app)
      .get('/api/v1/payments/unified-history')
      .set('Authorization', `Bearer ${taskerToken}`);
    
    console.log('Unified History Response Status:', historyResponse.status);
    console.log('Unified History Response Body:', JSON.stringify(historyResponse.body, null, 2));
    
    console.log('\nNuvei SimplyConnect Challenge 3D 2.0 Test completed.');
    
  } catch (error) {
    console.error('Error during Nuvei test:', error);
  } finally {
    // Clean up
    try {
      await User.deleteMany({ email: { $in: ['testprovider@example.com', 'testtasker@example.com'] } });
      await Gig.deleteMany({ title: 'Test Gig for Nuvei SimplyConnect' });
      await Contract.deleteMany({ amount: 100.00 });
      await NuveiPayment.deleteMany({ amount: 10000 });
      console.log('\nTest data cleaned up.');
    } catch (cleanupError) {
      console.error('Error during cleanup:', cleanupError);
    }
    
    await mongoose.disconnect();
  }
};

// Run the test
runNuveiTest().catch(console.error);