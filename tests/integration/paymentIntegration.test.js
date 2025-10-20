import mongoose from 'mongoose';
import { testUsers, createToken, request, app } from '../setup.js';
import User from '../../src/models/User.js';
import Contract from '../../src/models/Contract.js';
import { Gig } from '../../src/models/Gig.js';
import Payment from '../../src/models/Payment.js';

describe('Payment Integration Tests', () => {
  let provider, tasker, admin, providerToken, taskerToken, adminToken, gig, contract;

  beforeEach(async () => {
    // Clear all collections
    await User.deleteMany({});
    await Gig.deleteMany({});
    await Contract.deleteMany({});
    await Payment.deleteMany({});

    // Create test users
    provider = await User.create(testUsers.provider);
    tasker = await User.create(testUsers.tasker);
    admin = await User.create(testUsers.admin);

    // Create tokens
    providerToken = createToken(provider._id);
    taskerToken = createToken(tasker._id);
    adminToken = createToken(admin._id);

    // Create test gig
    gig = await Gig.create({
      title: 'Test Gig',
      description: 'Test gig description',
      category: 'Household Services',
      cost: 50.00,
      location: {
        address: '123 Test St',
        city: 'Test City',
        state: 'Test State',
        postalCode: '12345',
        country: 'Test Country'
      },
      isRemote: false,
      deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      duration: 2.5,
      skills: ['cleaning', 'organizing'],
      postedBy: provider._id
    });

    // Create test contract
    contract = await Contract.create({
      gig: gig._id,
      provider: provider._id,
      tasker: tasker._id,
      status: 'completed',
      amount: 100.00,
      agreedCost: 100.00
    });
  });

  describe('Payment Creation', () => {
    it('should create a payment successfully', async () => {
      const paymentData = {
        contract: contract._id,
        gig: gig._id,
        payer: provider._id,
        payee: tasker._id,
        amount: 10000, // $100.00 in cents
        currency: 'cad',
        applicationFeeAmount: 1500, // $15.00 platform fee
        amountReceivedByPayee: 8500, // $85.00 received by tasker
        status: 'succeeded',
        stripeConnectedAccountId: 'acct_test',
        taxAmount: 1300, // $13.00 tax
        amountAfterTax: 8700 // $87.00 after tax
      };

      const payment = await Payment.create(paymentData);
      
      expect(payment).toBeDefined();
      expect(payment.amount).toBe(10000);
      expect(payment.currency).toBe('cad');
      expect(payment.status).toBe('succeeded');
    });
  });

  describe('Invoice PDF Generation', () => {
    let payment;

    beforeEach(async () => {
      payment = await Payment.create({
        contract: contract._id,
        gig: gig._id,
        payer: provider._id,
        payee: tasker._id,
        amount: 10000,
        currency: 'cad',
        applicationFeeAmount: 1500,
        amountReceivedByPayee: 8500,
        status: 'succeeded',
        stripeConnectedAccountId: 'acct_test',
        taxAmount: 1300,
        amountAfterTax: 8700
      });
    });

    it('should allow provider to download invoice PDF', async () => {
      const res = await request(app)
        .get(`/api/v1/payments/${payment._id}/invoice-pdf`)
        .set('Authorization', `Bearer ${providerToken}`)
        .expect('Content-Type', /pdf/)
        .expect(200);
      
      expect(res.header['content-disposition']).toMatch(/attachment/);
      expect(res.body.length).toBeGreaterThan(100); // PDF should not be empty
    });
  });
});
