import Stripe from 'stripe';
import Payment from '../models/Payment.js';
import Contract from '../models/Contract.js';
import User from '../models/User.js';
import AppError from '../utils/AppError.js';
import catchAsync from '../utils/catchAsync.js';
import mongoose from 'mongoose';

// Initialize Stripe with the secret key from environment variables
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// --- Create Payment Intent for Contract (Provider -> Tasker via Platform) ---
export const createPaymentIntentForContract = catchAsync(async (req, res, next) => {
    const { contractId } = req.params;
    const providerId = req.user.id;

    // Check if the contractId is valid
    if (!mongoose.Types.ObjectId.isValid(contractId)) return next(new AppError('Invalid Contract ID format.', 400));

    // Fetch the contract along with the tasker details
    const contract = await Contract.findById(contractId).populate('tasker', 'stripeAccountId stripePayoutsEnabled');
    if (!contract) return next(new AppError('Contract not found.', 404));

    // Check if the provider is authorized to make the payment
    if (contract.provider.toString() !== providerId) return next(new AppError('Not authorized to pay for this contract.', 403));

    // Ensure that the contract is in a valid status for payment
    if (!['pending_payment', 'failed'].includes(contract.status) && contract.status !== 'pending_contract') {
        return next(new AppError(`Contract not awaiting payment (status: ${contract.status}).`, 400));
    }

    // Ensure that the tasker has connected a valid Stripe account and has enabled payouts
    if (!contract.tasker?.stripeAccountId) return next(new AppError('Tasker has not connected Stripe.', 400));
    if (!contract.tasker?.stripePayoutsEnabled) return next(new AppError('Tasker Stripe onboarding incomplete or payouts disabled.', 400));

    const taskerStripeAccountId = contract.tasker.stripeAccountId;
    const amountInCents = Math.round(contract.agreedCost * 100); // Convert cost to cents
    if (amountInCents <= 0) return next(new AppError('Invalid contract cost.', 400));

    // Calculate the application fee based on the platform's percentage
    const feePercentage = parseFloat(process.env.PLATFORM_FEE_PERCENT) || 0;
    const applicationFeeAmount = Math.round(amountInCents * (feePercentage / 100));

    const paymentCurrency = 'cad';

    // Check if there's an existing payment record for the contract
    let payment = await Payment.findOne({ contract: contractId });
    if (!payment) {
        // If no payment record exists, create a new one
        payment = await Payment.create({
            contract: contractId,
            gig: contract.gig,
            payer: providerId,
            payee: contract.tasker._id,
            amount: amountInCents,
            currency: paymentCurrency,
            status: 'requires_payment_method',
            stripeConnectedAccountId: taskerStripeAccountId,
            applicationFeeAmount: applicationFeeAmount
        });
    } else if (!['requires_payment_method', 'failed'].includes(payment.status)) {
        // If payment is already in another status, reject the operation
        return next(new AppError(`Payment already in status: ${payment.status}`, 400));
    } else {
        // Update payment if retrying
        payment.amount = amountInCents;
        payment.currency = paymentCurrency;
        payment.stripeConnectedAccountId = taskerStripeAccountId;
        payment.applicationFeeAmount = applicationFeeAmount;
        payment.status = 'requires_payment_method';
        await payment.save();
    }

    // Define the parameters for the payment intent
    const paymentIntentParams = {
        amount: amountInCents,
        currency: payment.currency,
        automatic_payment_methods: { enabled: true },
        capture_method: 'automatic',
        application_fee_amount: payment.applicationFeeAmount,
        transfer_data: { destination: taskerStripeAccountId },
        metadata: {
            paymentId: payment._id.toString(),
            contractId: contractId.toString(),
            providerId: providerId.toString(),
            taskerId: contract.tasker._id.toString()
        }
    };

    // Attempt to update or create the payment intent
    let paymentIntent;
    if (payment.stripePaymentIntentId) {
        try {
            paymentIntent = await stripe.paymentIntents.update(payment.stripePaymentIntentId, {
                amount: amountInCents,
                application_fee_amount: payment.applicationFeeAmount,
                transfer_data: paymentIntentParams.transfer_data,
                metadata: paymentIntentParams.metadata
            });
        } catch (error) {
            if (error.code === 'payment_intent_unexpected_state' || error.code === 'resource_missing') {
                // If an error occurs, create a new payment intent
                paymentIntent = await stripe.paymentIntents.create(paymentIntentParams);
                payment.stripePaymentIntentId = paymentIntent.id;
            } else {
                throw error;
            }
        }
    } else {
        // If there's no existing payment intent, create one
        paymentIntent = await stripe.paymentIntents.create(paymentIntentParams);
        payment.stripePaymentIntentId = paymentIntent.id;
    }

    // Save payment with the payment intent ID
    payment.status = 'requires_payment_method';
    await payment.save();

    // Respond with the client secret to complete the payment
    res.status(200).json({
        status: 'success',
        clientSecret: paymentIntent.client_secret,
        paymentId: payment._id
    });
});

// --- Stripe Webhook Handler ---
export const stripeWebhookHandler = async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    let event;

    // Verify the webhook signature
    try {
        event = stripe.webhooks.constructEvent(req.rawBody, sig, webhookSecret);
    } catch (err) {
        console.error(`❌ Webhook signature verification failed: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    const dataObject = event.data.object;

    // Handle different event types from Stripe
    switch (event.type) {
        case 'payment_intent.succeeded':
            await handlePaymentIntentSucceeded(dataObject);
            break;
        case 'payment_intent.processing':
            await handlePaymentIntentProcessing(dataObject);
            break;
        case 'payment_intent.payment_failed':
            await handlePaymentIntentFailed(dataObject);
            break;
        case 'payment_intent.canceled':
            await handlePaymentIntentCanceled(dataObject);
            break;
        case 'account.updated':
            await handleAccountUpdated(dataObject);
            break;
        case 'charge.refunded':
            await handleChargeRefunded(dataObject);
            break;
        default:
            // Log and ignore unhandled events
            break;
    }

    // Respond to Stripe to confirm receipt of the webhook
    res.status(200).json({ received: true });
};

// --- Initiate Refund for Contract ---
export const refundPaymentForContract = catchAsync(async (req, res, next) => {
    const { contractId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(contractId)) return next(new AppError('Invalid Contract ID format.', 400));

    const contract = await Contract.findById(contractId);
    if (!contract) return next(new AppError('Contract not found', 404));

    // Check if the user is authorized to refund
    if (!req.user.role.includes('admin') && contract.provider.toString() !== req.user.id) {
        return next(new AppError('Only admins or the provider can initiate refunds.', 403));
    }

    const payment = await Payment.findOne({ contract: contractId });
    if (!payment) return next(new AppError('Payment record not found', 404));
    if (payment.status !== 'succeeded') return next(new AppError(`Cannot refund payment with status: ${payment.status}`, 400));
    if (!payment.stripeChargeId) return next(new AppError('Cannot refund: Missing Stripe Charge ID.', 500));

    try {
        // Initiate the refund via Stripe
        const refund = await stripe.refunds.create({ charge: payment.stripeChargeId });
        console.log(`Stripe Refund created: ${refund.id}, Status: ${refund.status}`);

        // Update payment and contract status
        payment.status = 'refund_pending';
        payment.stripeRefundId = refund.id;
        await payment.save();
        contract.status = 'cancelled';
        await contract.save();

        res.status(200).json({ status: 'success', message: 'Refund initiated successfully.', refundId: refund.id });
    } catch (error) {
        console.error(`❌ Error creating Stripe Refund for Charge ${payment.stripeChargeId}:`, error);
        return next(new AppError(`Failed to initiate refund: ${error.message}.`, 500));
    }
});

// --- Create Stripe Account for User ---
export const createStripeAccount = catchAsync(async (req, res, next) => {
    const user = await User.findById(req.user.id);
    if (!user) return next(new AppError('User not found.', 404));

    // If user already has a Stripe account, proceed to create the account link
    if (user.stripeAccountId) {
        return createStripeAccountLink(req, res, next);
    }

    try {
        // Create a new Stripe Express account
        const account = await stripe.accounts.create({
            type: 'express',
            country: 'CA',
            email: user.email,
            capabilities: {
                card_payments: { requested: true },
                transfers: { requested: true }
            },
            business_type: 'individual'
        });

        user.stripeAccountId = account.id;
        await user.save({ validateBeforeSave: false });
        return createStripeAccountLink(req, res, next);
    } catch (error) {
        console.error('Error creating Stripe account:', error);
        return next(new AppError('Could not create Stripe account.', 500));
    }
});

// --- Generate Stripe Account Onboarding Link ---
export const createStripeAccountLink = catchAsync(async (req, res, next) => {
    const user = await User.findById(req.user.id).select('+stripeAccountId');
    if (!user || !user.stripeAccountId) return next(new AppError('Stripe account not found for user.', 400));

    try {
        // Create the Stripe account link for onboarding
        const accountLink = await stripe.accountLinks.create({
            account: user.stripeAccountId,
            refresh_url: `${process.env.FRONTEND_URL}/stripe-onboarding/refresh`,
            return_url: `${process.env.FRONTEND_URL}/stripe-onboarding/return`,
            type: 'account_onboarding',
            collect: 'eventually'
        });

        res.status(200).json({ status: 'success', url: accountLink.url });
    } catch (error) {
        console.error(`Error creating Account Link for ${user.stripeAccountId}:`, error);
        return next(new AppError('Could not create onboarding link.', 500));
    }
});

// --- Get Stripe Account Status ---
export const getStripeAccountStatus = catchAsync(async (req, res, next) => {
    const user = await User.findById(req.user.id).select('+stripeAccountId');
    if (!user || !user.stripeAccountId) return next(new AppError('Stripe account not found for user.', 400));

    try {
        const account = await stripe.accounts.retrieve(user.stripeAccountId);
        res.status(200).json({
            status: 'success',
            stripeAccountStatus: account.capabilities.transfers === 'active' ? 'active' : 'incomplete'
        });
    } catch (error) {
        console.error(`Error retrieving Stripe account ${user.stripeAccountId}:`, error);
        return next(new AppError('Could not retrieve account status.', 500));
    }
});
