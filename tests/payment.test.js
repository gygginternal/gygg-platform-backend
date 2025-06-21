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
      password: 'password123',
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