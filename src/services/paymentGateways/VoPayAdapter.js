import PaymentGatewayInterface from './PaymentGatewayInterface.js';
import axios from 'axios';

/**
 * VoPay Payment Gateway Adapter
 * Implements the PaymentGatewayInterface for VoPay
 * VoPay is a Fintech-as-a-Service platform that enables embedded payments
 */
class VoPayAdapter extends PaymentGatewayInterface {
  constructor() {
    super();
    this.vopayApiUrl = process.env.VOPAY_API_URL || 'https://api.vopay.com';
    this.vopayApiKey = process.env.VOPAY_API_KEY;
    this.vopayClientId = process.env.VOPAY_CLIENT_ID;
    this.vopayClientSecret = process.env.VOPAY_CLIENT_SECRET;
    
    // Validate required environment variables
    if (!this.vopayApiKey || !this.vopayClientId || !this.vopayClientSecret) {
      throw new Error('VoPay configuration is incomplete. Please provide VOPAY_API_KEY, VOPAY_CLIENT_ID, and VOPAY_CLIENT_SECRET in environment variables.');
    }
    
    // Initialize axios instance for VoPay API calls
    this.apiClient = axios.create({
      baseURL: this.vopayApiUrl,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
  }

  /**
   * Authenticate with VoPay API to get access token
   * @returns {Promise<string>} Access token
   */
  async authenticate() {
    try {
      const response = await this.apiClient.post('/oauth2/token', {
        grant_type: 'client_credentials',
        client_id: this.vopayClientId,
        client_secret: this.vopayClientSecret
      });
      
      return response.data.access_token;
    } catch (error) {
      throw new Error(`VoPay authentication failed: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Create a payment intent
   * @param {Object} paymentData - Payment details
   * @returns {Promise<Object>} Payment intent details
   */
  async createPaymentIntent(paymentData) {
    try {
      const token = await this.authenticate();
      
      // Prepare payment request for VoPay
      const paymentRequest = {
        amount: paymentData.amount / 100, // Convert cents to dollars
        currency: paymentData.currency.toUpperCase(),
        reference_number: `GYGG-${Date.now()}`,
        description: paymentData.description || 'Payment for services on Gygg Platform',
        sender_email: paymentData.senderEmail,
        recipient_email: paymentData.recipientEmail,
        sender_first_name: paymentData.senderFirstName,
        sender_last_name: paymentData.senderLastName,
        recipient_first_name: paymentData.recipientFirstName,
        recipient_last_name: paymentData.recipientLastName,
        // Add other VoPay-specific parameters as needed
      };
      
      // For bank transfers, we might use EFT (Electronic Fund Transfer)
      const response = await this.apiClient.post('/eft/send-money', paymentRequest, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      return {
        id: response.data.transaction_id,
        status: response.data.status,
        amount: paymentData.amount,
        currency: paymentData.currency,
        gateway: 'vopay',
        trackingId: response.data.tracking_id,
        recipientInstructions: `Recipient will receive an email notification to deposit $${(paymentData.amount / 100).toFixed(2)}`,
        estimatedCompletion: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      };
    } catch (error) {
      throw new Error(`VoPay payment intent creation failed: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Capture a payment
   * @param {string} paymentId - Payment identifier
   * @returns {Promise<Object>} Capture result
   */
  async capturePayment(paymentId) {
    try {
      // VoPay payments are typically immediate or require manual confirmation
      // This method would check the status of the payment
      const token = await this.authenticate();
      
      const response = await this.apiClient.get(`/transactions/${paymentId}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      return {
        id: paymentId,
        status: response.data.status,
        gateway: 'vopay',
      };
    } catch (error) {
      throw new Error(`VoPay payment capture failed: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Refund a payment
   * @param {string} paymentId - Payment identifier
   * @param {number} amount - Amount to refund (optional)
   * @returns {Promise<Object>} Refund result
   */
  async refundPayment(paymentId, amount) {
    try {
      const token = await this.authenticate();
      
      const refundRequest = {
        transaction_id: paymentId,
        amount: amount ? amount / 100 : undefined, // Convert cents to dollars if provided
        reason: 'Requested by customer'
      };
      
      const response = await this.apiClient.post('/refunds', refundRequest, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      return {
        id: response.data.refund_id,
        status: response.data.status,
        amount: amount || 0,
        gateway: 'vopay',
      };
    } catch (error) {
      throw new Error(`VoPay refund failed: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Get payment status
   * @param {string} paymentId - Payment identifier
   * @returns {Promise<Object>} Payment status
   */
  async getPaymentStatus(paymentId) {
    try {
      const token = await this.authenticate();
      
      const response = await this.apiClient.get(`/transactions/${paymentId}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      return {
        id: paymentId,
        status: response.data.status,
        amount: response.data.amount ? Math.round(response.data.amount * 100) : 0, // Convert to cents
        currency: response.data.currency?.toLowerCase() || 'cad',
        gateway: 'vopay',
      };
    } catch (error) {
      throw new Error(`Failed to retrieve VoPay payment status: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Create a payout/withdrawal
   * @param {Object} payoutData - Payout details
   * @returns {Promise<Object>} Payout result
   */
  async createPayout(payoutData) {
    try {
      const token = await this.authenticate();
      
      const payoutRequest = {
        amount: payoutData.amount / 100, // Convert cents to dollars
        currency: payoutData.currency.toUpperCase(),
        recipient_account_id: payoutData.accountId,
        reference_number: `WITHDRAWAL-${Date.now()}`,
        description: 'Gygg Platform Withdrawal'
      };
      
      const response = await this.apiClient.post('/payouts', payoutRequest, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      return {
        id: response.data.payout_id,
        status: response.data.status,
        arrivalDate: response.data.arrival_date ? new Date(response.data.arrival_date) : new Date(Date.now() + 24 * 60 * 60 * 1000),
        gateway: 'vopay',
      };
    } catch (error) {
      throw new Error(`VoPay payout creation failed: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Get account balance
   * @param {string} accountId - Account identifier
   * @returns {Promise<Object>} Balance information
   */
  async getBalance(accountId) {
    try {
      const token = await this.authenticate();
      
      const response = await this.apiClient.get(`/accounts/${accountId}/balance`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      return {
        available: response.data.available_balances || [],
        pending: response.data.pending_balances || [],
        gateway: 'vopay',
      };
    } catch (error) {
      throw new Error(`Failed to retrieve VoPay balance: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Create/connect an account
   * @param {Object} accountData - Account details
   * @returns {Promise<Object>} Account information
   */
  async createAccount(accountData) {
    try {
      const token = await this.authenticate();
      
      const accountRequest = {
        business_name: accountData.businessName,
        contact_email: accountData.email,
        country: accountData.country || 'CA',
        // Add other account details as needed
      };
      
      const response = await this.apiClient.post('/accounts', accountRequest, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      return {
        id: response.data.account_id,
        status: 'active',
        gateway: 'vopay',
      };
    } catch (error) {
      throw new Error(`VoPay account creation failed: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Get account status
   * @param {string} accountId - Account identifier
   * @returns {Promise<Object>} Account status
   */
  async getAccountStatus(accountId) {
    try {
      const token = await this.authenticate();
      
      const response = await this.apiClient.get(`/accounts/${accountId}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      return {
        id: accountId,
        detailsSubmitted: response.data.details_submitted || true,
        chargesEnabled: response.data.charges_enabled || true,
        payoutsEnabled: response.data.payouts_enabled || true,
        status: response.data.status || 'active',
        gateway: 'vopay',
      };
    } catch (error) {
      throw new Error(`Failed to retrieve VoPay account status: ${error.response?.data?.message || error.message}`);
    }
  }
}

export default VoPayAdapter;