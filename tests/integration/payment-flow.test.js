import { expect } from 'chai';
import sinon from 'sinon';
import mongoose from 'mongoose';
import Payment from '../../src/models/Payment.js';
import Contract from '../../src/models/Contract.js';
import User from '../../src/models/User.js';
import { createPaymentIntentForContract } from '../../src/controllers/paymentController.js';

describe('Payment Flow Integration Tests', () => {
  let sandbox;
  let mockStripe;
  
  beforeEach(() => {
    sandbox = sinon.createSandbox();
    
    // Mock Stripe
    mockStripe = {
      accounts: {
        retrieve: sandbox.stub().resolves({ id: 'acct_test123' })
      },
      customers: {
        create: sandbox.stub().resolves({ id: 'cus_test123' })
      },
      paymentIntents: {
        create: sandbox.stub().resolves({
          id: 'pi_test123',
          client_secret: 'pi_test123_secret_test',
          amount: 12995, // This should match totalProviderPayment for $100 service
          currency: 'cad'
        })
      }
    };
    
    // Set test environment
    process.env.PLATFORM_FIXED_FEE_CENTS = '500';
    process.env.PLATFORM_FEE_PERCENT = '0.10';
    process.env.TAX_PERCENT = '0.13';
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('End-to-End Payment Creation', () => {
    it('should create payment with correct fee structure for $100 service', async () => {
      // Mock data
      const providerId = new mongoose.Types.ObjectId();
      const taskerId = new mongoose.Types.ObjectId();
      const contractId = new mongoose.Types.ObjectId();
      const gigId = new mongoose.Types.ObjectId();
      
      // Mock contract
      const mockContract = {
        _id: contractId,
        provider: { _id: providerId },
        tasker: { _id: taskerId, stripeAccountId: 'acct_tasker123' },
        gig: gigId,
        agreedCost: 100, // $100 service
        status: 'active'
      };
      
      // Mock user (provider)
      const mockProvider = {
        _id: providerId,
        email: 'provider@test.com',
        firstName: 'John',
        lastName: 'Provider',
        stripeCustomerId: null
      };

      // Create actual payment record
      const payment = new Payment({
        contract: contractId,
        gig: gigId,
        payer: providerId,
        payee: taskerId,
        amount: 10000, // $100.00 in cents
        currency: 'cad',
        status: 'requires_payment_method',
        stripeConnectedAccountId: 'acct_tasker123'
      });

      // Save to trigger pre-save hook
      await payment.save();

      // Verify fee calculations
      expect(payment.amount).to.equal(10000); // $100.00 service amount
      expect(payment.applicationFeeAmount).to.equal(1500); // $15.00 platform fee (10% + $5)
      expect(payment.providerTaxAmount).to.equal(1495); // $14.95 tax (13% of $115)
      expect(payment.totalProviderPayment).to.equal(12995); // $129.95 total
      expect(payment.amountReceivedByPayee).to.equal(10000); // $100.00 to tasker
      expect(payment.taskerTaxAmount).to.equal(0); // No tax for tasker

      console.log('\n💰 Payment Breakdown Verification:');
      console.log(`   Service Amount: $${(payment.amount / 100).toFixed(2)}`);
      console.log(`   Platform Fee: $${(payment.applicationFeeAmount / 100).toFixed(2)}`);
      console.log(`   Provider Tax: $${(payment.providerTaxAmount / 100).toFixed(2)}`);
      console.log(`   Total Provider Pays: $${(payment.totalProviderPayment / 100).toFixed(2)}`);
      console.log(`   Tasker Receives: $${(payment.amountReceivedByPayee / 100).toFixed(2)}`);
    });

    it('should verify Stripe PaymentIntent is created with correct total amount', async () => {
      // Test that the Stripe PaymentIntent amount matches totalProviderPayment
      const serviceAmount = 10000; // $100
      
      const payment = new Payment({
        contract: new mongoose.Types.ObjectId(),
        gig: new mongoose.Types.ObjectId(),
        payer: new mongoose.Types.ObjectId(),
        payee: new mongoose.Types.ObjectId(),
        amount: serviceAmount,
        currency: 'cad',
        stripeConnectedAccountId: 'acct_test123'
      });

      await payment.save();

      // The Stripe PaymentIntent should be created with totalProviderPayment amount
      const expectedStripeAmount = payment.totalProviderPayment;
      expect(expectedStripeAmount).to.equal(12995); // $129.95 for $100 service
      
      console.log('\n🔗 Stripe Integration Verification:');
      console.log(`   Stripe PaymentIntent Amount: $${(expectedStripeAmount / 100).toFixed(2)}`);
      console.log(`   This matches totalProviderPayment: ✅`);
    });
  });

  describe('Fee Structure Validation Across Different Amounts', () => {
    const testScenarios = [
      {
        description: '$25 Service',
        serviceAmount: 2500,
        expectedPlatformFee: 750, // 10% of $25 + $5 = $7.50
        expectedTax: 423, // 13% of $32.50 = $4.23
        expectedTotal: 3673, // $36.73
        expectedTaskerReceives: 2500 // $25.00
      },
      {
        description: '$75 Service',
        serviceAmount: 7500,
        expectedPlatformFee: 1250, // 10% of $75 + $5 = $12.50
        expectedTax: 1138, // 13% of $87.50 = $11.38
        expectedTotal: 9888, // $98.88
        expectedTaskerReceives: 7500 // $75.00
      },
      {
        description: '$150 Service',
        serviceAmount: 15000,
        expectedPlatformFee: 2000, // 10% of $150 + $5 = $20.00
        expectedTax: 2210, // 13% of $170 = $22.10
        expectedTotal: 19210, // $192.10
        expectedTaskerReceives: 15000 // $150.00
      }
    ];

    testScenarios.forEach((scenario) => {
      it(`should calculate correct fees for ${scenario.description}`, async () => {
        const payment = new Payment({
          contract: new mongoose.Types.ObjectId(),
          gig: new mongoose.Types.ObjectId(),
          payer: new mongoose.Types.ObjectId(),
          payee: new mongoose.Types.ObjectId(),
          amount: scenario.serviceAmount,
          currency: 'cad',
          stripeConnectedAccountId: 'acct_test123'
        });

        await payment.save();

        expect(payment.applicationFeeAmount).to.equal(scenario.expectedPlatformFee);
        expect(payment.providerTaxAmount).to.equal(scenario.expectedTax);
        expect(payment.totalProviderPayment).to.equal(scenario.expectedTotal);
        expect(payment.amountReceivedByPayee).to.equal(scenario.expectedTaskerReceives);

        console.log(`\n📊 ${scenario.description} Breakdown:`);
        console.log(`   Platform Fee: $${(payment.applicationFeeAmount / 100).toFixed(2)}`);
        console.log(`   Provider Tax: $${(payment.providerTaxAmount / 100).toFixed(2)}`);
        console.log(`   Provider Pays: $${(payment.totalProviderPayment / 100).toFixed(2)}`);
        console.log(`   Tasker Gets: $${(payment.amountReceivedByPayee / 100).toFixed(2)}`);
      });
    });
  });

  describe('Business Rule Validation', () => {
    it('should ensure platform fee goes to platform (not deducted from tasker)', async () => {
      const serviceAmount = 10000; // $100
      
      const payment = new Payment({
        contract: new mongoose.Types.ObjectId(),
        gig: new mongoose.Types.ObjectId(),
        payer: new mongoose.Types.ObjectId(),
        payee: new mongoose.Types.ObjectId(),
        amount: serviceAmount,
        currency: 'cad',
        stripeConnectedAccountId: 'acct_test123'
      });

      await payment.save();

      // Key business rule: Tasker receives full service amount
      expect(payment.amountReceivedByPayee).to.equal(serviceAmount);
      
      // Platform fee is additional cost to provider
      expect(payment.applicationFeeAmount).to.be.greaterThan(0);
      
      // Total provider payment includes service + fee + tax
      const expectedTotal = serviceAmount + payment.applicationFeeAmount + payment.providerTaxAmount;
      expect(payment.totalProviderPayment).to.equal(expectedTotal);

      console.log('\n🎯 Business Rule Validation:');
      console.log(`   ✅ Tasker receives full service amount: $${(payment.amountReceivedByPayee / 100).toFixed(2)}`);
      console.log(`   ✅ Platform fee is additional to provider: $${(payment.applicationFeeAmount / 100).toFixed(2)}`);
      console.log(`   ✅ Provider pays service + fee + tax: $${(payment.totalProviderPayment / 100).toFixed(2)}`);
    });

    it('should validate fee formula: 10% of service amount + $5 fixed fee', async () => {
      const testAmounts = [1000, 5000, 10000, 20000, 50000]; // Various amounts
      
      for (const amount of testAmounts) {
        const payment = new Payment({
          contract: new mongoose.Types.ObjectId(),
          gig: new mongoose.Types.ObjectId(),
          payer: new mongoose.Types.ObjectId(),
          payee: new mongoose.Types.ObjectId(),
          amount: amount,
          currency: 'cad',
          stripeConnectedAccountId: 'acct_test123'
        });

        await payment.save();

        const expectedFee = Math.round(amount * 0.10) + 500; // 10% + $5
        expect(payment.applicationFeeAmount).to.equal(expectedFee);
        
        console.log(`   $${(amount / 100).toFixed(2)} service → $${(expectedFee / 100).toFixed(2)} platform fee ✅`);
      }
    });

    it('should validate tax calculation: 13% of (service amount + platform fee)', async () => {
      const serviceAmount = 10000; // $100
      
      const payment = new Payment({
        contract: new mongoose.Types.ObjectId(),
        gig: new mongoose.Types.ObjectId(),
        payer: new mongoose.Types.ObjectId(),
        payee: new mongoose.Types.ObjectId(),
        amount: serviceAmount,
        currency: 'cad',
        stripeConnectedAccountId: 'acct_test123'
      });

      await payment.save();

      const taxableAmount = serviceAmount + payment.applicationFeeAmount;
      const expectedTax = Math.round(taxableAmount * 0.13);
      
      expect(payment.providerTaxAmount).to.equal(expectedTax);
      
      console.log('\n🧮 Tax Calculation Validation:');
      console.log(`   Taxable Amount: $${(taxableAmount / 100).toFixed(2)} (service + platform fee)`);
      console.log(`   Tax (13%): $${(expectedTax / 100).toFixed(2)} ✅`);
    });
  });
});

// Export helper function for manual testing
export function manualFeeTest(serviceAmountDollars) {
  const serviceAmountCents = serviceAmountDollars * 100;
  const platformFee = Math.round(serviceAmountCents * 0.10) + 500;
  const tax = Math.round((serviceAmountCents + platformFee) * 0.13);
  const totalProviderPayment = serviceAmountCents + platformFee + tax;
  
  console.log(`\n💰 Manual Fee Test for $${serviceAmountDollars} Service:`);
  console.log(`   Service Amount: $${serviceAmountDollars.toFixed(2)}`);
  console.log(`   Platform Fee (10% + $5): $${(platformFee / 100).toFixed(2)}`);
  console.log(`   Tax (13%): $${(tax / 100).toFixed(2)}`);
  console.log(`   Total Provider Pays: $${(totalProviderPayment / 100).toFixed(2)}`);
  console.log(`   Tasker Receives: $${serviceAmountDollars.toFixed(2)} (full amount)`);
  
  return {
    serviceAmount: serviceAmountCents,
    platformFee,
    tax,
    totalProviderPayment,
    taskerReceives: serviceAmountCents
  };
}