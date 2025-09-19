import StripeAdapter from './StripeAdapter.js';
import VoPayAdapter from './VoPayAdapter.js';

/**
 * Payment Gateway Factory
 * Factory pattern implementation for creating payment gateway instances
 * Supports Stripe and VoPay for Canadian market
 */
class PaymentGatewayFactory {
  /**
   * Create a payment gateway instance
   * @param {string} gatewayType - Type of payment gateway ('stripe', 'vopay')
   * @returns {PaymentGatewayInterface} Payment gateway instance
   */
  static createGateway(gatewayType) {
    switch (gatewayType.toLowerCase()) {
      case 'stripe':
        return new StripeAdapter();
      case 'vopay':
        return new VoPayAdapter();
      default:
        throw new Error(`Unsupported payment gateway: ${gatewayType}. Supported gateways are: stripe, vopay`);
    }
  }

  /**
   * Get list of supported payment gateways
   * @returns {Array<string>} List of supported gateway types
   */
  static getSupportedGateways() {
    return ['stripe', 'vopay'];
  }
  
  /**
   * Get gateway details for display
   * @returns {Array<Object>} List of gateway details
   */
  static getGatewayDetails() {
    return [
      {
        id: 'stripe',
        name: 'Credit/Debit Card',
        description: 'Pay with Visa, Mastercard, American Express',
        icon: '💳',
        currencies: ['CAD', 'USD'],
        countries: ['CA', 'US'],
        processingTime: 'Instant',
        typicalFee: '2.9% + $0.30'
      },
      {
        id: 'vopay',
        name: 'Bank Transfer (VoPay)',
        description: 'Pay with your Canadian bank account',
        icon: '🏦',
        currencies: ['CAD'],
        countries: ['CA'],
        processingTime: '1-2 business days',
        typicalFee: 'Varies by bank'
      }
    ];
  }
}

export default PaymentGatewayFactory;