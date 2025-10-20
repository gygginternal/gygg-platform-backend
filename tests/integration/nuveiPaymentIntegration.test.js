import mongoose from 'mongoose';
import { testUsers, createToken, request, app } from '../setup.js';
import User from '../../src/models/User.js';
import Contract from '../../src/models/Contract.js';
import { Gig } from '../../src/models/Gig.js';
import NuveiPayment from '../../src/models/NuveiPayment.js';

describe('Nuvei Payment Integration Tests', () => {
  let provider, tasker, admin, providerToken, taskerToken, adminToken, gig, contract;

  beforeEach(async () => {
    // Clear all collections
    await User.deleteMany({});
    await Gig.deleteMany({});
    await Contract.deleteMany({});
    await NuveiPayment.deleteMany({});

    // Create test users
    provider = await User.create(testUsers.provider);
    tasker = await User.create(testUsers.tasker);
    admin = await User.create(testUsers.admin);

    // Set up Nuvei account for testing
    provider.nuveiAccountId = 'nuv_test_provider';
    provider.nuveiCustomerId = 'cust_test_provider';
    provider.nuveiBankTransferEnabled = true;
    provider.nuveiBankDetails = {
      accountNumber: '123456789',
      institutionNumber: '001',
      transitNumber: '12345',
      accountType: 'checking'
    };
    await provider.save();

    tasker.nuveiAccountId = 'nuv_test_tasker';
    tasker.nuveiCustomerId = 'cust_test_tasker';
    tasker.nuveiBankTransferEnabled = true;
    tasker.nuveiBankDetails = {
      accountNumber: '987654321',
      institutionNumber: '002',
      transitNumber: '54321',
      accountType: 'checking'
    };
    await tasker.save();

    // Create tokens
    providerToken = createToken(provider._id);
    taskerToken = createToken(tasker._id);
    adminToken = createToken(admin._id);

    // Create test gig
    gig = await Gig.create({
      title: 'Test Gig for Nuvei',
      description: 'Test gig description for Nuvei payment',
      category: 'Household Services',
      cost: 75.00,
      location: {
        address: '456 Test Ave',
        city: 'Test City',
        state: 'Test State',
        postalCode: '67890',
        country: 'Test Country'
      },
      isRemote: false,
      deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      duration: 3.0,
      skills: ['cleaning', 'organizing'],
      postedBy: provider._id
    });

    // Create test contract
    contract = await Contract.create({
      gig: gig._id,
      provider: provider._id,
      tasker: tasker._id,
      status: 'completed',
      amount: 75.00,
      agreedCost: 75.00
    });
  });

  describe('Nuvei Payment Creation', () => {
    it('should create a Nuvei payment successfully', async () => {
      const paymentData = {
        contract: contract._id,
        gig: gig._id,
        payer: provider._id,
        payee: tasker._id,
        amount: 7500, // $75.00 in cents
        currency: 'cad',
        applicationFeeAmount: 1250, // $12.50 platform fee
        amountReceivedByPayee: 6250, // $62.50 received by tasker
        status: 'succeeded',
        type: 'payment',
        paymentMethodType: 'card',
        nuveiSessionId: 'sess_test_123',
        nuveiTransactionId: 'txn_test_123',
        nuveiMerchantId: 'merch_test_123',
        nuveiMerchantSiteId: 'site_test_123',
        nuveiOrderId: 'order_test_123',
        nuveiPaymentMethod: 'card',
        taxAmount: 975, // $9.75 tax
        amountAfterTax: 6525, // $65.25 after tax
        totalProviderPayment: 9000, // $90.00 total provider pays
        providerTaxAmount: 975, // $9.75 provider tax
        taskerTaxAmount: 0 // Tasker pays no tax
      };

      const payment = await NuveiPayment.create(paymentData);
      
      expect(payment).toBeDefined();
      expect(payment.amount).toBe(7500);
      expect(payment.currency).toBe('cad');
      expect(payment.status).toBe('succeeded');
      expect(payment.paymentMethodType).toBe('card');
      expect(payment.nuveiSessionId).toBe('sess_test_123');
      expect(payment.nuveiTransactionId).toBe('txn_test_123');
    });
  });

  describe('Nuvei Payment Session', () => {
    let payment;

    beforeEach(async () => {
      payment = await NuveiPayment.create({
        contract: contract._id,
        gig: gig._id,
        payer: provider._id,
        payee: tasker._id,
        amount: 7500,
        currency: 'cad',
        applicationFeeAmount: 1250,
        amountReceivedByPayee: 6250,
        status: 'requires_payment_method',
        type: 'payment',
        paymentMethodType: 'card',
        nuveiSessionId: 'sess_test_123',
        nuveiTransactionId: 'txn_test_123',
        nuveiMerchantId: 'merch_test_123',
        nuveiMerchantSiteId: 'site_test_123',
        nuveiOrderId: 'order_test_123',
        nuveiPaymentMethod: 'card',
        taxAmount: 975,
        amountAfterTax: 6525,
        totalProviderPayment: 9000,
        providerTaxAmount: 975,
        taskerTaxAmount: 0
      });
    });

    it('should allow provider to create Nuvei payment session', async () => {
      const res = await request(app)
        .post(`/api/v1/payments/nuvei/create-session`)
        .set('Authorization', `Bearer ${providerToken}`)
        .send({
          contractId: contract._id,
          paymentMethod: 'card'
        })
        .expect(200);

      expect(res.body.status).toBe('success');
      expect(res.body.data).toHaveProperty('sessionId');
      expect(res.body.data).toHaveProperty('transactionId');
      expect(res.body.data).toHaveProperty('paymentId');
      expect(res.body.data).toHaveProperty('amount');
      expect(res.body.data).toHaveProperty('currency');
    });

    it('should allow tasker to get Nuvei payment session', async () => {
      const res = await request(app)
        .get(`/api/v1/payments/nuvei/session/${payment.nuveiSessionId}`)
        .set('Authorization', `Bearer ${taskerToken}`)
        .expect(200);

      expect(res.body.status).toBe('success');
      expect(res.body.data).toHaveProperty('sessionId', payment.nuveiSessionId);
      expect(res.body.data).toHaveProperty('status');
      expect(res.body.data).toHaveProperty('amount');
      expect(res.body.data).toHaveProperty('currency');
    });
  });

  describe('Nuvei Withdrawal', () => {
    let payment;

    beforeEach(async () => {
      // Create a successful payment first
      payment = await NuveiPayment.create({
        contract: contract._id,
        gig: gig._id,
        payer: provider._id,
        payee: tasker._id,
        amount: 7500,
        currency: 'cad',
        applicationFeeAmount: 1250,
        amountReceivedByPayee: 6250,
        status: 'succeeded',
        type: 'payment',
        paymentMethodType: 'card',
        nuveiSessionId: 'sess_test_123',
        nuveiTransactionId: 'txn_test_123',
        nuveiMerchantId: 'merch_test_123',
        nuveiMerchantSiteId: 'site_test_123',
        nuveiOrderId: 'order_test_123',
        nuveiPaymentMethod: 'card',
        taxAmount: 975,
        amountAfterTax: 6525,
        totalProviderPayment: 9000,
        providerTaxAmount: 975,
        taskerTaxAmount: 0
      });
    });

    it('should allow tasker to process Nuvei withdrawal', async () => {
      const res = await request(app)
        .post(`/api/v1/payments/nuvei/withdraw`)
        .set('Authorization', `Bearer ${taskerToken}`)
        .send({
          amount: 50.00
        })
        .expect(200);

      expect(res.body.status).toBe('success');
      expect(res.body.message).toBe('Nuvei withdrawal processed successfully');
      expect(res.body.data).toHaveProperty('payoutId');
      expect(res.body.data).toHaveProperty('amount', 50.00);
      expect(res.body.data).toHaveProperty('status');
    });

    it('should not allow provider to process Nuvei withdrawal', async () => {
      const res = await request(app)
        .post(`/api/v1/payments/nuvei/withdraw`)
        .set('Authorization', `Bearer ${providerToken}`)
        .send({
          amount: 50.00
        });

      expect(res.statusCode).toBe(403);
    });

    it('should validate withdrawal amount', async () => {
      const res = await request(app)
        .post(`/api/v1/payments/nuvei/withdraw`)
        .set('Authorization', `Bearer ${taskerToken}`)
        .send({
          amount: 0
        });

      expect(res.statusCode).toBe(400);
    });

    it('should return 400 if user has no Nuvei account', async () => {
      // Remove Nuvei account from tasker
      tasker.nuveiAccountId = undefined;
      tasker.nuveiBankTransferEnabled = false;
      await tasker.save();

      const res = await request(app)
        .post(`/api/v1/payments/nuvei/withdraw`)
        .set('Authorization', `Bearer ${taskerToken}`)
        .send({
          amount: 50.00
        });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('Nuvei Onboarding', () => {
    it('should allow user to start Nuvei onboarding', async () => {
      const res = await request(app)
        .post(`/api/v1/payments/nuvei/start-onboarding`)
        .set('Authorization', `Bearer ${taskerToken}`)
        .expect(200);

      expect(res.body.status).toBe('success');
      expect(res.body.data).toHaveProperty('onboardingUrl');
      expect(res.body.data).toHaveProperty('accountId');
      expect(res.body.data).toHaveProperty('customerId');
      expect(res.body.data.message).toBe('Nuvei onboarding session started successfully');
    });

    it('should allow user to check Nuvei onboarding status', async () => {
      const res = await request(app)
        .get(`/api/v1/payments/nuvei/onboarding-status`)
        .set('Authorization', `Bearer ${taskerToken}`)
        .expect(200);

      expect(res.body.status).toBe('success');
      expect(res.body.data).toHaveProperty('status');
      expect(res.body.data).toHaveProperty('connected');
      expect(res.body.data).toHaveProperty('bankTransferEnabled');
      expect(res.body.data).toHaveProperty('accountId');
      expect(res.body.data).toHaveProperty('customerId');
      expect(res.body.data).toHaveProperty('verificationStatus');
    });
  });

  describe('Unified Payment System', () => {
    let stripePayment, nuveiPayment;

    beforeEach(async () => {
      // Create a Stripe payment
      stripePayment = await Payment.create({
        contract: contract._id,
        gig: gig._id,
        payer: provider._id,
        payee: tasker._id,
        amount: 10000,
        currency: 'cad',
        applicationFeeAmount: 1500,
        amountReceivedByPayee: 8500,
        status: 'succeeded',
        paymentProvider: 'stripe',
        stripeConnectedAccountId: 'acct_test',
        taxAmount: 1300,
        amountAfterTax: 8700,
        totalProviderPayment: 11500,
        providerTaxAmount: 1300,
        taskerTaxAmount: 0
      });

      // Create a Nuvei payment
      nuveiPayment = await NuveiPayment.create({
        contract: contract._id,
        gig: gig._id,
        payer: provider._id,
        payee: tasker._id,
        amount: 7500,
        currency: 'cad',
        applicationFeeAmount: 1250,
        amountReceivedByPayee: 6250,
        status: 'succeeded',
        paymentProvider: 'nuvei',
        type: 'payment',
        paymentMethodType: 'card',
        nuveiSessionId: 'sess_test_123',
        nuveiTransactionId: 'txn_test_123',
        nuveiMerchantId: 'merch_test_123',
        nuveiMerchantSiteId: 'site_test_123',
        nuveiOrderId: 'order_test_123',
        nuveiPaymentMethod: 'card',
        taxAmount: 975,
        amountAfterTax: 6525,
        totalProviderPayment: 9000,
        providerTaxAmount: 975,
        taskerTaxAmount: 0
      });
    });

    it('should get unified payment history', async () => {
      const res = await request(app)
        .get(`/api/v1/payments/unified-history`)
        .set('Authorization', `Bearer ${taskerToken}`)
        .expect(200);

      expect(res.body.status).toBe('success');
      expect(res.body.data).toHaveProperty('payments');
      expect(Array.isArray(res.body.data.payments)).toBe(true);
      expect(res.body.data.payments.length).toBeGreaterThanOrEqual(2); // At least Stripe and Nuvei payments
    });

    it('should get consolidated earnings summary', async () => {
      const res = await request(app)
        .get(`/api/v1/payments/consolidated-summary`)
        .set('Authorization', `Bearer ${taskerToken}`)
        .expect(200);

      expect(res.body.status).toBe('success');
      expect(res.body.data).toHaveProperty('summary');
      expect(res.body.data.summary).toHaveProperty('period');
      expect(res.body.data.summary).toHaveProperty('currency');
      expect(res.body.data.summary).toHaveProperty('paymentProvider');
    });

    it('should get payment statistics', async () => {
      const res = await request(app)
        .get(`/api/v1/payments/statistics`)
        .set('Authorization', `Bearer ${taskerToken}`)
        .expect(200);

      expect(res.body.status).toBe('success');
      expect(res.body.data).toHaveProperty('bySystem');
      expect(res.body.data.bySystem).toHaveProperty('stripe');
      expect(res.body.data.bySystem).toHaveProperty('nuvei');
      expect(res.body.data).toHaveProperty('consolidated');
    });

    it('should get user payment methods', async () => {
      const res = await request(app)
        .get(`/api/v1/payments/user-payment-methods`)
        .set('Authorization', `Bearer ${taskerToken}`)
        .expect(200);

      expect(res.body.status).toBe('success');
      expect(res.body.data).toHaveProperty('methods');
      expect(res.body.data.methods).toHaveProperty('stripe');
      expect(res.body.data.methods).toHaveProperty('nuvei');
      expect(res.body.data.methods).toHaveProperty('defaultMethod');
    });
  });
});
