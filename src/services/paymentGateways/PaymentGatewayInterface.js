/**
 * Payment Gateway Interface
 * Defines the contract that all payment gateways must implement
 */
class PaymentGatewayInterface {
  /**
   * Create a payment intent
   * @param {Object} paymentData - Payment details
   * @returns {Promise<Object>} Payment intent details
   */
  async createPaymentIntent(paymentData) {
    throw new Error('Method not implemented');
  }

  /**
   * Capture a payment
   * @param {string} paymentId - Payment identifier
   * @returns {Promise<Object>} Capture result
   */
  async capturePayment(paymentId) {
    throw new Error('Method not implemented');
  }

  /**
   * Refund a payment
   * @param {string} paymentId - Payment identifier
   * @param {number} amount - Amount to refund (optional)
   * @returns {Promise<Object>} Refund result
   */
  async refundPayment(paymentId, amount) {
    throw new Error('Method not implemented');
  }

  /**
   * Get payment status
   * @param {string} paymentId - Payment identifier
   * @returns {Promise<Object>} Payment status
   */
  async getPaymentStatus(paymentId) {
    throw new Error('Method not implemented');
  }

  /**
   * Create a payout/withdrawal
   * @param {Object} payoutData - Payout details
   * @returns {Promise<Object>} Payout result
   */
  async createPayout(payoutData) {
    throw new Error('Method not implemented');
  }

  /**
   * Get account balance
   * @param {string} accountId - Account identifier
   * @returns {Promise<Object>} Balance information
   */
  async getBalance(accountId) {
    throw new Error('Method not implemented');
  }

  /**
   * Create/connect an account
   * @param {Object} accountData - Account details
   * @returns {Promise<Object>} Account information
   */
  async createAccount(accountData) {
    throw new Error('Method not implemented');
  }

  /**
   * Get account status
   * @param {string} accountId - Account identifier
   * @returns {Promise<Object>} Account status
   */
  async getAccountStatus(accountId) {
    throw new Error('Method not implemented');
  }
}

export default PaymentGatewayInterface;