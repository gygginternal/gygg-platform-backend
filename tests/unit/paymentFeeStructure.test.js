import mongoose from 'mongoose';
import Payment from '../../src/models/Payment.js';
import { setupTestDB, cleanupTestDB } from '../setup.js';

describe('Payment Fee Structure Unit Tests', () => {
  // Test environment variables
  const originalEnv = process.env;
  
  beforeEach(() => {
    // Set test environment variables
    process.env.PLATFORM_FIXED_FEE_CENTS = '500'; // $5.00
    process.env.PLATFORM_FEE_PERCENT = '0.10'; // 10%
    process.env.TAX_PERCENT = '0.13'; // 13%
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('Payment Model Fee Calculations', () => {
    it('should calculate correct fees for $100 service amount', async () => {
      // Test data: $100 service
      const serviceAmountCents = 10000; // $100.00 in cents
      
      const payment = new Payment({
        payer: new mongoose.Types.ObjectId(),
        payee: new mongoose.Types.ObjectId(),
        amount: serviceAmountCents,
        currency: 'cad',
        contract: new mongoose.Types.ObjectId(),
        gig: new mongoose.Types.ObjectId(),
        contract: new mongoose.Types.ObjectId(),
          gig: new mongoose.Types.ObjectId(),
          stripeConnectedAccountId: 'acct_test123',
        type: 'payment'
      });

      // Save to trigger pre-save hook calculations
      await payment.save();
      
      // Expected calculations:
      // Service Amount: $100.00 (10000 cents)
      // Platform Fee: 10% of $100 + $5 = $10 + $5 = $15.00 (1500 cents)
      // Provider Tax: 13% of ($100 + $15) = 13% of $115 = $14.95 (1495 cents)
      // Total Provider Payment: $100 + $15 + $14.95 = $129.95 (12995 cents)
      // Tasker Receives: $100.00 (10000 cents)

      expect(payment.amount).toBe(10000); // Service amount
      expect(payment.applicationFeeAmount).toBe(1500); // $15.00 platform fee
      expect(payment.providerTaxAmount).toBe(1495); // $14.95 tax
      expect(payment.totalProviderPayment).toBe(12995); // $129.95 total
      expect(payment.amountReceivedByPayee).toBe(10000); // $100.00 to tasker
      expect(payment.taskerTaxAmount).toBe(0); // No tax for tasker
    });

    it('should calculate correct fees for $50 service amount', async () => {
      // Test data: $50 service
      const serviceAmountCents = 5000; // $50.00 in cents
      
      const payment = new Payment({
        payer: new mongoose.Types.ObjectId(),
        payee: new mongoose.Types.ObjectId(),
        amount: serviceAmountCents,
        currency: 'cad',
        contract: new mongoose.Types.ObjectId(),
        gig: new mongoose.Types.ObjectId(),
        contract: new mongoose.Types.ObjectId(),
          gig: new mongoose.Types.ObjectId(),
          stripeConnectedAccountId: 'acct_test123',
        type: 'payment'
      });

      await payment.save();
      
      // Expected calculations:
      // Service Amount: $50.00 (5000 cents)
      // Platform Fee: 10% of $50 + $5 = $5 + $5 = $10.00 (1000 cents)
      // Provider Tax: 13% of ($50 + $10) = 13% of $60 = $7.80 (780 cents)
      // Total Provider Payment: $50 + $10 + $7.80 = $67.80 (6780 cents)
      // Tasker Receives: $50.00 (5000 cents)

      expect(payment.amount).toBe(5000);
      expect(payment.applicationFeeAmount).toBe(1000); // $10.00 platform fee
      expect(payment.providerTaxAmount).toBe(780); // $7.80 tax
      expect(payment.totalProviderPayment).toBe(6780); // $67.80 total
      expect(payment.amountReceivedByPayee).toBe(5000); // $50.00 to tasker
    });

    it('should calculate correct fees for $200 service amount', async () => {
      // Test data: $200 service
      const serviceAmountCents = 20000; // $200.00 in cents
      
      const payment = new Payment({
        payer: new mongoose.Types.ObjectId(),
        payee: new mongoose.Types.ObjectId(),
        amount: serviceAmountCents,
        currency: 'cad',
        contract: new mongoose.Types.ObjectId(),
        gig: new mongoose.Types.ObjectId(),
        contract: new mongoose.Types.ObjectId(),
          gig: new mongoose.Types.ObjectId(),
          stripeConnectedAccountId: 'acct_test123',
        type: 'payment'
      });

      await payment.save();
      
      // Expected calculations:
      // Service Amount: $200.00 (20000 cents)
      // Platform Fee: 10% of $200 + $5 = $20 + $5 = $25.00 (2500 cents)
      // Provider Tax: 13% of ($200 + $25) = 13% of $225 = $29.25 (2925 cents)
      // Total Provider Payment: $200 + $25 + $29.25 = $254.25 (25425 cents)
      // Tasker Receives: $200.00 (20000 cents)

      expect(payment.amount).toBe(20000);
      expect(payment.applicationFeeAmount).toBe(2500); // $25.00 platform fee
      expect(payment.providerTaxAmount).toBe(2925); // $29.25 tax
      expect(payment.totalProviderPayment).toBe(25425); // $254.25 total
      expect(payment.amountReceivedByPayee).toBe(20000); // $200.00 to tasker
    });

    it('should handle withdrawal type correctly (no fees)', async () => {
      const payment = new Payment({
        payer: new mongoose.Types.ObjectId(),
        payee: new mongoose.Types.ObjectId(),
        amount: 10000, // $100.00
        currency: 'cad',
        contract: new mongoose.Types.ObjectId(),
          gig: new mongoose.Types.ObjectId(),
          stripeConnectedAccountId: 'acct_test123',
        type: 'withdrawal'
      });

      await payment.save();
      
      // Withdrawals should have no fees
      expect(payment.applicationFeeAmount).toBe(0);
      expect(payment.providerTaxAmount).toBe(0);
      expect(payment.taxAmount).toBe(0);
      expect(payment.totalProviderPayment).toBe(10000);
      expect(payment.amountReceivedByPayee).toBe(10000);
    });
  });

  describe('Fee Structure Validation Tests', () => {
    const testCases = [
      {
        serviceAmount: 2500, // $25.00
        expectedPlatformFee: 750, // $7.50 (10% of $25 + $5)
        expectedProviderTax: 423, // $4.23 (13% of $32.50)
        expectedTotal: 3673, // $36.73
        expectedTaskerReceives: 2500 // $25.00
      },
      {
        serviceAmount: 7500, // $75.00
        expectedPlatformFee: 1250, // $12.50 (10% of $75 + $5)
        expectedProviderTax: 1138, // $11.38 (13% of $87.50)
        expectedTotal: 9888, // $98.88
        expectedTaskerReceives: 7500 // $75.00
      },
      {
        serviceAmount: 15000, // $150.00
        expectedPlatformFee: 2000, // $20.00 (10% of $150 + $5)
        expectedProviderTax: 2210, // $22.10 (13% of $170)
        expectedTotal: 19210, // $192.10
        expectedTaskerReceives: 15000 // $150.00
      }
    ];

    testCases.forEach(({ serviceAmount, expectedPlatformFee, expectedProviderTax, expectedTotal, expectedTaskerReceives }, index) => {
      it(`should calculate correct fees for test case ${index + 1} (${(serviceAmount / 100).toFixed(2)})`, async () => {
        const payment = new Payment({
          payer: new mongoose.Types.ObjectId(),
          payee: new mongoose.Types.ObjectId(),
          amount: serviceAmount,
          currency: 'cad',
          contract: new mongoose.Types.ObjectId(),
          gig: new mongoose.Types.ObjectId(),
          contract: new mongoose.Types.ObjectId(),
          gig: new mongoose.Types.ObjectId(),
          stripeConnectedAccountId: 'acct_test123',
          type: 'payment'
        });

        await payment.save();
        
        expect(payment.applicationFeeAmount).toBe(expectedPlatformFee, 
          `Platform fee should be $${(expectedPlatformFee / 100).toFixed(2)}`);
        expect(payment.providerTaxAmount).toBe(expectedProviderTax, 
          `Provider tax should be $${(expectedProviderTax / 100).toFixed(2)}`);
        expect(payment.totalProviderPayment).toBe(expectedTotal, 
          `Total provider payment should be $${(expectedTotal / 100).toFixed(2)}`);
        expect(payment.amountReceivedByPayee).toBe(expectedTaskerReceives, 
          `Tasker should receive $${(expectedTaskerReceives / 100).toFixed(2)}`);
      });
    });
  });

  describe('Fee Structure Business Rules', () => {
    it('should ensure tasker always receives the full listed amount', async () => {
      const testAmounts = [1000, 5000, 10000, 25000, 50000]; // Various amounts
      
      for (const amount of testAmounts) {
        const payment = new Payment({
          payer: new mongoose.Types.ObjectId(),
          payee: new mongoose.Types.ObjectId(),
          amount: amount,
          currency: 'cad',
          contract: new mongoose.Types.ObjectId(),
          gig: new mongoose.Types.ObjectId(),
          stripeConnectedAccountId: 'acct_test123',
          type: 'payment'
        });

        await payment.save();
        
        expect(payment.amountReceivedByPayee).toBe(amount, 
          `Tasker should receive full amount of $${(amount / 100).toFixed(2)}`);
      }
    });

    it('should ensure platform fee is always 10% + $5', async () => {
      const testAmounts = [1000, 5000, 10000, 25000, 50000];
      
      for (const amount of testAmounts) {
        const payment = new Payment({
          payer: new mongoose.Types.ObjectId(),
          payee: new mongoose.Types.ObjectId(),
          amount: amount,
          currency: 'cad',
          contract: new mongoose.Types.ObjectId(),
          gig: new mongoose.Types.ObjectId(),
          stripeConnectedAccountId: 'acct_test123',
          type: 'payment'
        });

        await payment.save();
        
        const expectedFee = Math.round(amount * 0.10) + 500; // 10% + $5
        expect(payment.applicationFeeAmount).toBe(expectedFee, 
          `Platform fee should be 10% + $5 for amount $${(amount / 100).toFixed(2)}`);
      }
    });

    it('should ensure provider pays service amount + platform fee + tax', async () => {
      const serviceAmount = 10000; // $100
      
      const payment = new Payment({
        payer: new mongoose.Types.ObjectId(),
        payee: new mongoose.Types.ObjectId(),
        amount: serviceAmount,
        currency: 'cad',
        contract: new mongoose.Types.ObjectId(),
        gig: new mongoose.Types.ObjectId(),
        contract: new mongoose.Types.ObjectId(),
          gig: new mongoose.Types.ObjectId(),
          stripeConnectedAccountId: 'acct_test123',
        type: 'payment'
      });

      await payment.save();
      
      const expectedTotal = serviceAmount + payment.applicationFeeAmount + payment.providerTaxAmount;
      expect(payment.totalProviderPayment).toBe(expectedTotal, 
        'Provider should pay service amount + platform fee + tax');
    });

    it('should ensure tax is calculated on service amount + platform fee', async () => {
      const serviceAmount = 10000; // $100
      
      const payment = new Payment({
        payer: new mongoose.Types.ObjectId(),
        payee: new mongoose.Types.ObjectId(),
        amount: serviceAmount,
        currency: 'cad',
        contract: new mongoose.Types.ObjectId(),
        gig: new mongoose.Types.ObjectId(),
        contract: new mongoose.Types.ObjectId(),
          gig: new mongoose.Types.ObjectId(),
          stripeConnectedAccountId: 'acct_test123',
        type: 'payment'
      });

      await payment.save();
      
      const taxableAmount = serviceAmount + payment.applicationFeeAmount;
      const expectedTax = Math.round(taxableAmount * 0.13); // 13% tax
      expect(payment.providerTaxAmount).toBe(expectedTax, 
        'Tax should be calculated on service amount + platform fee');
    });
  });

  describe('Edge Cases', () => {
    it('should handle minimum service amount correctly', async () => {
      const payment = new Payment({
        payer: new mongoose.Types.ObjectId(),
        payee: new mongoose.Types.ObjectId(),
        amount: 100, // $1.00 minimum
        currency: 'cad',
        contract: new mongoose.Types.ObjectId(),
        gig: new mongoose.Types.ObjectId(),
        contract: new mongoose.Types.ObjectId(),
          gig: new mongoose.Types.ObjectId(),
          stripeConnectedAccountId: 'acct_test123',
        type: 'payment'
      });

      await payment.save();
      
      // Even for $1, platform fee should be 10% + $5 = $5.10
      expect(payment.applicationFeeAmount).toBe(510); // $5.10
      expect(payment.amountReceivedByPayee).toBe(100); // Tasker still gets $1.00
    });

    it('should handle large service amounts correctly', async () => {
      const payment = new Payment({
        payer: new mongoose.Types.ObjectId(),
        payee: new mongoose.Types.ObjectId(),
        amount: 100000, // $1000.00
        currency: 'cad',
        contract: new mongoose.Types.ObjectId(),
        gig: new mongoose.Types.ObjectId(),
        contract: new mongoose.Types.ObjectId(),
          gig: new mongoose.Types.ObjectId(),
          stripeConnectedAccountId: 'acct_test123',
        type: 'payment'
      });

      await payment.save();
      
      // Platform fee: 10% of $1000 + $5 = $100 + $5 = $105
      expect(payment.applicationFeeAmount).toBe(10500); // $105.00
      expect(payment.amountReceivedByPayee).toBe(100000); // Tasker gets full $1000
    });
  });
});