import { testUsers, testGig, createToken, request, app } from './setup.js';
import User from '../src/models/User.js';
import Contract from '../src/models/Contract.js';
import { Gig } from '../src/models/Gig.js';
import Payment from '../src/models/Payment.js';

let provider, tasker, admin, providerToken, taskerToken, adminToken, payment, gig, contract;

beforeEach(async () => {
  await User.deleteMany({});
  await Gig.deleteMany({});
  await Contract.deleteMany({});
  await Payment.deleteMany({});

  provider = await User.create(testUsers.provider);
  tasker = await User.create(testUsers.tasker);
  admin = await User.create(testUsers.admin);

  providerToken = createToken(provider._id);
  taskerToken = createToken(tasker._id);
  adminToken = createToken(admin._id);

  gig = await Gig.create({ ...testGig, postedBy: provider._id });
  contract = await Contract.create({
    gig: gig._id,
    provider: provider._id,
    tasker: tasker._id,
    status: 'completed',
    amount: 100.00,
    agreedCost: 100.00
  });
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

describe('Payments API', () => {
  it('should return 401 for unauthenticated access', async () => {
    const res = await request(app).get('/api/v1/payments');
    expect(res.statusCode).toBe(401);
  }, 10000);
});

describe('Invoice PDF Endpoint', () => {
  it('should allow provider to download invoice PDF', async () => {
    const res = await request(app)
      .get(`/api/v1/payments/${payment._id}/invoice-pdf`)
      .set('Authorization', `Bearer ${providerToken}`)
      .expect('Content-Type', /pdf/)
      .expect(200);
    expect(res.header['content-disposition']).toMatch(/attachment/);
    expect(res.body.length).toBeGreaterThan(100); // PDF should not be empty
  });

  it('should allow tasker to download invoice PDF', async () => {
    const res = await request(app)
      .get(`/api/v1/payments/${payment._id}/invoice-pdf`)
      .set('Authorization', `Bearer ${taskerToken}`)
      .expect('Content-Type', /pdf/)
      .expect(200);
    expect(res.header['content-disposition']).toMatch(/attachment/);
    expect(res.body.length).toBeGreaterThan(100);
  });

  it('should allow admin to download invoice PDF', async () => {
    const res = await request(app)
      .get(`/api/v1/payments/${payment._id}/invoice-pdf`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect('Content-Type', /pdf/)
      .expect(200);
    expect(res.header['content-disposition']).toMatch(/attachment/);
    expect(res.body.length).toBeGreaterThan(100);
  });

  it('should not allow unrelated user to download invoice PDF', async () => {
    const unrelatedUser = await User.create({
      email: 'unrelated@test.com',
      password: 'Password123!',
      role: ['provider'],
      phoneNo: '+1234567899',
      dateOfBirth: '1970-01-01',
      isEmailVerified: true
    });
    const unrelatedToken = createToken(unrelatedUser._id);
    const res = await request(app)
      .get(`/api/v1/payments/${payment._id}/invoice-pdf`)
      .set('Authorization', `Bearer ${unrelatedToken}`);
    expect(res.statusCode).toBe(403);
  });

  it('should return 404 for non-existent payment', async () => {
    const res = await request(app)
      .get(`/api/v1/payments/000000000000000000000000/invoice-pdf`)
      .set('Authorization', `Bearer ${providerToken}`);
    expect(res.statusCode).toBe(404);
  });
});

describe('Withdrawal Endpoints', () => {
  beforeEach(async () => {
    // Add Stripe account ID to tasker for withdrawal tests
    tasker.stripeAccountId = 'acct_test_tasker';
    await tasker.save();
  });

  describe('GET /api/v1/payments/balance', () => {
    it('should allow tasker to get balance', async () => {
      // Mock the Stripe balance response
      const mockBalance = {
        available: [{ amount: 5000, currency: 'usd' }],
        pending: [{ amount: 1000, currency: 'usd' }]
      };

      // Mock the stripe.balance.retrieve method
      const { stripe } = await import('../src/controllers/paymentController.js');
      const originalRetrieve = stripe.balance.retrieve;
      stripe.balance.retrieve = () => Promise.resolve(mockBalance);

      try {
        const res = await request(app)
          .get('/api/v1/payments/balance')
          .set('Authorization', `Bearer ${taskerToken}`)
          .expect(200);
        
        expect(res.body.status).toBe('success');
        expect(res.body.data).toHaveProperty('available');
        expect(res.body.data).toHaveProperty('pending');
        expect(res.body.data).toHaveProperty('currency');
      } finally {
        // Restore original method
        stripe.balance.retrieve = originalRetrieve;
      }
    });

    it('should not allow provider to get balance', async () => {
      const res = await request(app)
        .get('/api/v1/payments/balance')
        .set('Authorization', `Bearer ${providerToken}`);
      expect(res.statusCode).toBe(403);
    });

    it('should return 400 if user has no Stripe account', async () => {
      // Remove Stripe account from tasker
      tasker.stripeAccountId = undefined;
      await tasker.save();

      const res = await request(app)
        .get('/api/v1/payments/balance')
        .set('Authorization', `Bearer ${taskerToken}`);
      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST /api/v1/payments/withdraw', () => {
    it('should allow tasker to withdraw valid amount', async () => {
      // Mock Stripe responses
      const mockBalance = {
        available: [{ amount: 10000, currency: 'usd' }] // $100 available
      };
      const mockPayout = {
        id: 'po_test_123',
        status: 'pending',
        amount: 5000, // $50.00 in cents
        arrival_date: Math.floor(Date.now() / 1000) + 86400 // 24 hours from now
      };

      // Mock the stripe methods
      const { stripe } = await import('../src/controllers/paymentController.js');
      const originalBalanceRetrieve = stripe.balance.retrieve;
      const originalPayoutsCreate = stripe.payouts.create;

      stripe.balance.retrieve = () => Promise.resolve(mockBalance);
      stripe.payouts.create = () => Promise.resolve(mockPayout);

      try {
        const res = await request(app)
          .post('/api/v1/payments/withdraw')
          .set('Authorization', `Bearer ${taskerToken}`)
          .send({ amount: 50.00 })
          .expect(200);
        
        expect(res.body.status).toBe('success');
        expect(res.body.data).toHaveProperty('payoutId');
        expect(res.body.data).toHaveProperty('amount', 50.00);
        expect(res.body.data).toHaveProperty('status');
      } finally {
        // Restore original methods
        stripe.balance.retrieve = originalBalanceRetrieve;
        stripe.payouts.create = originalPayoutsCreate;
      }
    });

    it('should not allow provider to withdraw', async () => {
      const res = await request(app)
        .post('/api/v1/payments/withdraw')
        .set('Authorization', `Bearer ${providerToken}`)
        .send({ amount: 50.00 });
      expect(res.statusCode).toBe(403);
    });

    it('should validate withdrawal amount', async () => {
      const res = await request(app)
        .post('/api/v1/payments/withdraw')
        .set('Authorization', `Bearer ${taskerToken}`)
        .send({ amount: 0 });
      expect(res.statusCode).toBe(400);
    });

    it('should return 400 if user has no Stripe account', async () => {
      // Remove Stripe account from tasker
      tasker.stripeAccountId = undefined;
      await tasker.save();

      const res = await request(app)
        .post('/api/v1/payments/withdraw')
        .set('Authorization', `Bearer ${taskerToken}`)
        .send({ amount: 50.00 });
      expect(res.statusCode).toBe(400);
    });
  });
}); 