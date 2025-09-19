import PaymentGatewayInterface from './PaymentGatewayInterface.js';
import Stripe from 'stripe';

/**
 * Stripe Payment Gateway Adapter
 * Implements the PaymentGatewayInterface for Stripe
 */
class StripeAdapter extends PaymentGatewayInterface {
  constructor() {
    super();
    this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { 
      apiVersion: '2024-04-10' 
    });
  }

  async createPaymentIntent(paymentData) {
    try {
      const paymentIntent = await this.stripe.paymentIntents.create({
        amount: paymentData.amount,
        currency: paymentData.currency,
        // Add other Stripe-specific parameters as needed
        metadata: paymentData.metadata,
      });

      return {
        id: paymentIntent.id,
        clientSecret: paymentIntent.client_secret,
        status: paymentIntent.status,
        gateway: 'stripe',
      };
    } catch (error) {
      throw new Error(`Stripe payment intent creation failed: ${error.message}`);
    }
  }

  async capturePayment(paymentId) {
    try {
      const paymentIntent = await this.stripe.paymentIntents.capture(paymentId);
      return {
        id: paymentIntent.id,
        status: paymentIntent.status,
        gateway: 'stripe',
      };
    } catch (error) {
      throw new Error(`Stripe payment capture failed: ${error.message}`);
    }
  }

  async refundPayment(paymentId, amount) {
    try {
      const refund = await this.stripe.refunds.create({
        payment_intent: paymentId,
        amount: amount, // Optional - if not provided, full amount is refunded
      });

      return {
        id: refund.id,
        status: refund.status,
        amount: refund.amount,
        gateway: 'stripe',
      };
    } catch (error) {
      throw new Error(`Stripe refund failed: ${error.message}`);
    }
  }

  async getPaymentStatus(paymentId) {
    try {
      const paymentIntent = await this.stripe.paymentIntents.retrieve(paymentId);
      return {
        id: paymentIntent.id,
        status: paymentIntent.status,
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
        gateway: 'stripe',
      };
    } catch (error) {
      throw new Error(`Failed to retrieve Stripe payment status: ${error.message}`);
    }
  }

  async createPayout(payoutData) {
    try {
      const payout = await this.stripe.payouts.create({
        amount: payoutData.amount,
        currency: payoutData.currency,
        method: 'instant',
      }, {
        stripeAccount: payoutData.accountId,
      });

      return {
        id: payout.id,
        status: payout.status,
        arrivalDate: payout.arrival_date,
        gateway: 'stripe',
      };
    } catch (error) {
      throw new Error(`Stripe payout creation failed: ${error.message}`);
    }
  }

  async getBalance(accountId) {
    try {
      const balance = await this.stripe.balance.retrieve({
        stripeAccount: accountId,
      });

      return {
        available: balance.available,
        pending: balance.pending,
        gateway: 'stripe',
      };
    } catch (error) {
      throw new Error(`Failed to retrieve Stripe balance: ${error.message}`);
    }
  }

  async createAccount(accountData) {
    try {
      const account = await this.stripe.accounts.create({
        type: 'express',
        country: accountData.country || 'CA',
        email: accountData.email,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        // Add other account details as needed
      });

      return {
        id: account.id,
        gateway: 'stripe',
      };
    } catch (error) {
      throw new Error(`Stripe account creation failed: ${error.message}`);
    }
  }

  async getAccountStatus(accountId) {
    try {
      const account = await this.stripe.accounts.retrieve(accountId);
      return {
        id: account.id,
        detailsSubmitted: account.details_submitted,
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
        gateway: 'stripe',
      };
    } catch (error) {
      throw new Error(`Failed to retrieve Stripe account status: ${error.message}`);
    }
  }
}

export default StripeAdapter;