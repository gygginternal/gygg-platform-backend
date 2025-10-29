import mongoose from 'mongoose';
import NuveiPayment from '../../src/models/NuveiPayment.js';
import Contract from '../../src/models/Contract.js';
import User from '../../src/models/User.js';
import { Gig } from '../../src/models/Gig.js';

// Test data
const testProvider = {
  firstName: 'Test',
  lastName: 'Provider',
  email: 'testprovider@example.com',
  password: 'Password123!',
  role: ['provider'],
  phoneNo: '+1234567890',
  dateOfBirth: '1970-01-01',  // Make them 55 years old
  isEmailVerified: true,
  nuveiAccountId: 'nuv_test_provider',
  nuveiCustomerId: 'cust_test_provider',
};

const testTasker = {
  firstName: 'Test',
  lastName: 'Tasker',
  email: 'testtasker@example.com',
  password: 'Password123!',
  role: ['tasker'],
  phoneNo: '+1234567891',
  dateOfBirth: '1970-01-01',  // Make them 55 years old
  isEmailVerified: true,
  nuveiAccountId: 'nuv_test_tasker',
  nuveiCustomerId: 'cust_test_tasker',
};

const testGig = {
  title: 'Test Gig for Nuvei SimplyConnect',
  description: 'Test gig for SimplyConnect integration',
  category: 'Household Services',
  cost: 100.00,
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
  skills: ['testing', 'integration']
};

describe('NuveiPaymentService - Simply Connect', () => {
  let provider, tasker, gig, contract;
  let nuveiPaymentService;

  beforeEach(async () => {
    // Clear all collections
    await User.deleteMany({});
    await Gig.deleteMany({});
    await Contract.deleteMany({});
    await NuveiPayment.deleteMany({});

    // Create test users
    provider = await User.create(testProvider);
    tasker = await User.create(testTasker);

    // Create test gig
    gig = await Gig.create({ ...testGig, postedBy: provider._id });

    // Create test contract
    contract = await Contract.create({
      gig: gig._id,
      provider: provider._id,
      tasker: tasker._id,
      status: 'pending_payment',
      amount: 100.00,
      agreedCost: 100.00
    });

    // Import service after data setup to make sure we get fresh instance
    const { default: Service } = await import('../../src/services/payment/NuveiPaymentService.js');
    nuveiPaymentService = Service;
  });

  describe('createSimplyConnectSession', () => {
    it('should successfully create a Simply Connect session', async () => {
      // Mock the makeNuveiRequest to return a mock session
      const originalMakeNuveiRequest = nuveiPaymentService.makeNuveiRequest;
      nuveiPaymentService.makeNuveiRequest = jest.fn().mockResolvedValue({
        sessionId: 'sess_mock123',
        paymentPageUrl: 'https://secure.test.nuvei.com/payment',
        session_token: 'sess_mock123',
        redirectUrl: 'https://secure.test.nuvei.com/payment'
      });

      const result = await nuveiPaymentService.createSimplyConnectSession(
        contract._id.toString(),
        provider._id.toString(),
        100.00,
        'USD'
      );

      expect(result).toHaveProperty('sessionId');
      expect(result).toHaveProperty('clientRequestId');
      expect(result).toHaveProperty('checkoutParams');
      expect(result.amount).toBe(129.95);  // The total amount including fees and taxes
      expect(result.contractId).toBe(contract._id.toString());

      // Verify that payment was created in DB
      const payment = await NuveiPayment.findOne({ contract: contract._id });
      expect(payment).toBeTruthy();
      expect(payment.status).toBe('requires_payment_method');
      expect(payment.amount).toBe(10000); // 100.00 in cents
      expect(payment.isSimplyConnect).toBe(true);

      // Restore original function
      nuveiPaymentService.makeNuveiRequest = originalMakeNuveiRequest;
    });

    it('should throw error for invalid contract ID', async () => {
      await expect(
        nuveiPaymentService.createSimplyConnectSession(
          'invalid-id',
          provider._id.toString(),
          100.00,
          'USD'
        )
      ).rejects.toThrow('Invalid Contract ID format');
    });

    it('should throw error for non-existent contract', async () => {
      await expect(
        nuveiPaymentService.createSimplyConnectSession(
          new mongoose.Types.ObjectId(),
          provider._id.toString(),
          100.00,
          'USD'
        )
      ).rejects.toThrow('Contract not found');
    });

    it('should throw error for unauthorized provider', async () => {
      const otherProvider = await User.create({
        ...testProvider,
        email: 'otherprovider@example.com',
        phoneNo: '+1234567899'  // Use a different phone number
      });

      await expect(
        nuveiPaymentService.createSimplyConnectSession(
          contract._id.toString(),
          otherProvider._id.toString(),
          100.00,
          'USD'
        )
      ).rejects.toThrow('Not authorized to pay for this contract');
    });

    it('should throw error for invalid amount', async () => {
      await expect(
        nuveiPaymentService.createSimplyConnectSession(
          contract._id.toString(),
          provider._id.toString(),
          -100.00,
          'USD'
        )
      ).rejects.toThrow('Invalid amount provided');
    });

    it('should successfully create Simply Connect session even without provider Nuvei account', async () => {
      // Remove Nuvei account from provider
      await User.findByIdAndUpdate(provider._id, { $unset: { nuveiAccountId: 1 } });

      // For Simply Connect, we don't require the provider to have a Nuvei account pre-connected
      // This is the key feature that makes it "Simply Connect"
      const originalMakeNuveiRequest = nuveiPaymentService.makeNuveiRequest;
      nuveiPaymentService.makeNuveiRequest = jest.fn().mockResolvedValue({
        sessionId: 'sess_mock123',
        paymentPageUrl: 'https://secure.test.nuvei.com/payment',
        session_token: 'sess_mock123',
        redirectUrl: 'https://secure.test.nuvei.com/payment'
      });

      const result = await nuveiPaymentService.createSimplyConnectSession(
        contract._id.toString(),
        provider._id.toString(),
        100.00,
        'USD'
      );

      expect(result).toHaveProperty('sessionId');
      expect(result).toHaveProperty('clientRequestId');
      expect(result).toHaveProperty('checkoutParams');
      expect(result.amount).toBe(129.95);  // The total amount including fees and taxes
      expect(result.contractId).toBe(contract._id.toString());

      // Verify that payment was created in DB
      const payment = await NuveiPayment.findOne({ contract: contract._id });
      expect(payment).toBeTruthy();
      expect(payment.status).toBe('requires_payment_method');
      expect(payment.amount).toBe(10000); // 100.00 in cents
      expect(payment.isSimplyConnect).toBe(true);

      // Restore original function
      nuveiPaymentService.makeNuveiRequest = originalMakeNuveiRequest;
    });
  });

  describe('confirmSimplyConnectPayment', () => {
    let payment;

    beforeEach(async () => {
      // Create a payment record first
      payment = await NuveiPayment.create({
        contract: contract._id,
        gig: gig._id,
        payer: provider._id,
        payee: tasker._id,
        amount: 10000,
        currency: 'usd',
        status: 'requires_payment_method',
        type: 'payment',
        paymentMethodType: 'card',
        isSimplyConnect: true,
        nuveiClientRequestId: 'req_test123',
        amountReceivedByPayee: 10000, // Required field
        applicationFeeAmount: 0,      // Required field
        totalProviderPayment: 0,      // Required field but will be calculated by pre-save
        providerTaxAmount: 0,         // Required field
        taskerTaxAmount: 0,
        taxAmount: 0,
        amountAfterTax: 0,
        // Add required Nuvei fields that are conditionally required when status changes to completed
        nuveiSessionId: 'test_session_id',
        nuveiMerchantId: 'test_merchant_id',
        nuveiMerchantSiteId: 'test_site_id',
        nuveiOrderId: 'GYGG-test_order_id'
      });
    });

    it('should successfully confirm Simply Connect payment', async () => {
      // Mock the verification response
      const originalMakeNuveiRequest = nuveiPaymentService.makeNuveiRequest;
      nuveiPaymentService.makeNuveiRequest = jest.fn().mockResolvedValue({
        status: 'success',
        transactionStatus: 'approved',
        result: 'APPROVED'
      });

      const result = await nuveiPaymentService.confirmSimplyConnectPayment(
        contract._id.toString(),
        provider._id.toString(),
        'txn_123456',
        { paymentMethod: 'card', SessionId: 'sess_123456' }
      );

      expect(result.message).toBe('Payment confirmed successfully');
      expect(result.payment.status).toBe('succeeded');
      expect(result.payment.transactionId).toBe('txn_123456');

      // Verify payment was updated in DB
      const updatedPayment = await NuveiPayment.findById(payment._id);
      expect(updatedPayment.status).toBe('succeeded');
      expect(updatedPayment.nuveiTransactionId).toBe('txn_123456');

      // Verify contract was updated
      const updatedContract = await Contract.findById(contract._id);
      expect(updatedContract.status).toBe('completed');
      expect(updatedContract.paymentStatus).toBe('paid');

      // Restore original function
      nuveiPaymentService.makeNuveiRequest = originalMakeNuveiRequest;
    });

    it('should handle duplicate confirmation requests', async () => {
      // First, update the existing payment (from beforeEach) to have the transaction ID
      // but keep it in 'requires_payment_method' status to simulate a scenario where
      // the transaction ID was set but status wasn't updated (e.g., due to an error)
      await NuveiPayment.findByIdAndUpdate(payment._id, {
        nuveiTransactionId: 'txn_123456' // Set transaction ID but keep status as requires_payment_method
      });

      // Mock the verification response (though it shouldn't be reached due to duplicate check)
      const originalMakeNuveiRequest = nuveiPaymentService.makeNuveiRequest;
      nuveiPaymentService.makeNuveiRequest = jest.fn().mockResolvedValue({
        status: 'success',
        transactionStatus: 'approved'
      });

      // Try to confirm a payment - should detect duplicate since transaction ID matches
      const result = await nuveiPaymentService.confirmSimplyConnectPayment(
        contract._id.toString(),
        provider._id.toString(),
        'txn_123456', // Same transaction ID as set above
        { paymentMethod: 'card', SessionId: 'sess_123456' }
      );

      expect(result.message).toBe('Payment was already confirmed');

      // Restore original function
      nuveiPaymentService.makeNuveiRequest = originalMakeNuveiRequest;
    });

    it('should throw error for failed verification', async () => {
      // Create a new payment for this test to avoid conflicts
      const failedPayment = await NuveiPayment.create({
        contract: contract._id,
        gig: gig._id,
        payer: provider._id,
        payee: tasker._id,
        amount: 10000,
        currency: 'usd',
        status: 'requires_payment_method',
        type: 'payment',
        paymentMethodType: 'card',
        isSimplyConnect: true,
        nuveiClientRequestId: 'req_test125',
        amountReceivedByPayee: 10000, // Required field
        applicationFeeAmount: 0,      // Required field
        totalProviderPayment: 0,      // Required field but will be calculated by pre-save
        providerTaxAmount: 0,         // Required field
        taskerTaxAmount: 0,
        taxAmount: 0,
        amountAfterTax: 0,
        // Add required Nuvei fields that are conditionally required when status changes to completed
        nuveiSessionId: 'test_session_id',
        nuveiMerchantId: 'test_merchant_id',
        nuveiMerchantSiteId: 'test_site_id',
        nuveiOrderId: 'GYGG-test_order_id'
      });

      // For this test, we need to temporarily set NODE_ENV to something other than 'production'
      // and make the sandbox simulation return failure values instead of success
      // We'll do this by directly mocking the internal behavior
      const originalVerifyTransaction = nuveiPaymentService.verifyTransaction;
      
      // Mock verifyTransaction to return a failure result
      nuveiPaymentService.verifyTransaction = jest.fn().mockResolvedValue({
        verified: false,
        data: {
          transactionStatus: 'declined',  // Not 'APPROVED'
          result: 'DECLINED',             // Not 'APPROVED'  
          status: 'FAILURE'               // Not 'SUCCESS'
        }
      });

      // Also mock the actual verification logic by temporarily replacing the method
      const originalMakeNuveiRequest = nuveiPaymentService.makeNuveiRequest;
      // In case makeNuveiRequest is called (in production mode), return failure
      nuveiPaymentService.makeNuveiRequest = jest.fn().mockResolvedValue({
        transactionStatus: 'declined',
        result: 'DECLINED', 
        status: 'FAILURE'
      });

      await expect(
        nuveiPaymentService.confirmSimplyConnectPayment(
          contract._id.toString(),
          provider._id.toString(),
          'txn_123456',
          { paymentMethod: 'card', SessionId: 'sess_123456' }
        )
      ).rejects.toThrow('Nuvei payment verification failed');

      // Verify payment status was updated to failed
      const updatedPayment = await NuveiPayment.findById(failedPayment._id);
      expect(updatedPayment.status).toBe('failed');

      // Restore original functions
      nuveiPaymentService.verifyTransaction = originalVerifyTransaction;
      nuveiPaymentService.makeNuveiRequest = originalMakeNuveiRequest;
    });

    it('should throw error for invalid parameters', async () => {
      await expect(
        nuveiPaymentService.confirmSimplyConnectPayment(
          'invalid-id',
          provider._id.toString(),
          'txn_123456',
          { PaymentMethod: 'CC', SessionId: 'sess_123456' }
        )
      ).rejects.toThrow('Invalid Contract ID format');

      await expect(
        nuveiPaymentService.confirmSimplyConnectPayment(
          contract._id.toString(),
          'invalid-id',
          'txn_123456',
          { PaymentMethod: 'CC', SessionId: 'sess_123456' }
        )
      ).rejects.toThrow('Invalid Provider ID format');
    });

    it('should throw error for non-existent payment', async () => {
      // Delete the payment record
      await NuveiPayment.deleteOne({ _id: payment._id });

      await expect(
        nuveiPaymentService.confirmSimplyConnectPayment(
          contract._id.toString(),
          provider._id.toString(),
          'txn_123456',
          { PaymentMethod: 'CC', SessionId: 'sess_123456' }
        )
      ).rejects.toThrow('Nuvei payment record not found for this contract');
    });
  });
});