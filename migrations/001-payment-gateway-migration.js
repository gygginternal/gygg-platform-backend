/**
 * Migration Script: Update existing Stripe-only payments to support multiple payment gateways
 * 
 * This script migrates existing payment records and user accounts from the Stripe-only
 * implementation to the new multi-gateway system.
 */

import mongoose from 'mongoose';
import Payment from '../src/models/Payment.js';
import User from '../src/models/User.js';
import dotenv from 'dotenv';

dotenv.config();

// Connect to MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.DATABASE, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('Database connected successfully');
  } catch (err) {
    console.error('Database connection error:', err);
    process.exit(1);
  }
};

// Migration function for payments
const migratePayments = async () => {
  try {
    console.log('Starting payment migration...');
    
    // Find all payments with Stripe-specific fields
    const stripePayments = await Payment.find({
      $or: [
        { stripePaymentIntentId: { $exists: true, $ne: null } },
        { stripePaymentIntentSecret: { $exists: true, $ne: null } },
        { stripePayoutId: { $exists: true, $ne: null } },
        { stripeChargeId: { $exists: true, $ne: null } },
        { stripeTransferId: { $exists: true, $ne: null } },
        { stripeRefundId: { $exists: true, $ne: null } },
        { stripeConnectedAccountId: { $exists: true, $ne: null } }
      ]
    });
    
    console.log(`Found ${stripePayments.length} Stripe payments to migrate`);
    
    let migratedCount = 0;
    
    for (const payment of stripePayments) {
      try {
        // Set payment gateway to 'stripe'
        payment.paymentGateway = 'stripe';
        payment.paymentMethodType = 'stripe';
        
        // Map Stripe-specific fields to generic fields
        if (payment.stripePaymentIntentId) {
          payment.paymentIntentId = payment.stripePaymentIntentId;
        }
        
        if (payment.stripePayoutId) {
          payment.payoutId = payment.stripePayoutId;
        }
        
        if (payment.stripeRefundId) {
          payment.refundId = payment.stripeRefundId;
        }
        
        if (payment.stripeTransferId) {
          payment.transferId = payment.stripeTransferId;
        }
        
        if (payment.stripeConnectedAccountId) {
          payment.providerAccountId = payment.stripeConnectedAccountId;
        }
        
        // Store Stripe-specific metadata
        payment.gatewayMetadata = payment.gatewayMetadata || new Map();
        
        if (payment.stripePaymentIntentSecret) {
          payment.gatewayMetadata.set('clientSecret', payment.stripePaymentIntentSecret);
        }
        
        if (payment.stripeChargeId) {
          payment.gatewayMetadata.set('chargeId', payment.stripeChargeId);
        }
        
        // Save the updated payment
        await payment.save();
        migratedCount++;
        
        if (migratedCount % 100 === 0) {
          console.log(`Migrated ${migratedCount} payments...`);
        }
      } catch (error) {
        console.error(`Error migrating payment ${payment._id}:`, error);
      }
    }
    
    console.log(`Successfully migrated ${migratedCount} payments`);
  } catch (error) {
    console.error('Error during payment migration:', error);
  }
};

// Migration function for users
const migrateUsers = async () => {
  try {
    console.log('Starting user migration...');
    
    // Find all users with Stripe-specific fields
    const stripeUsers = await User.find({
      $or: [
        { stripeAccountId: { $exists: true, $ne: null } },
        { stripeCustomerId: { $exists: true, $ne: null } },
        { stripeChargesEnabled: { $exists: true } },
        { stripePayoutsEnabled: { $exists: true } }
      ]
    });
    
    console.log(`Found ${stripeUsers.length} Stripe users to migrate`);
    
    let migratedCount = 0;
    
    for (const user of stripeUsers) {
      try {
        // Set payment gateway to 'stripe' if they have a Stripe account
        if (user.stripeAccountId) {
          user.paymentGateway = 'stripe';
          user.providerAccountId = user.stripeAccountId;
        }
        
        // Save the updated user
        await user.save();
        migratedCount++;
        
        if (migratedCount % 100 === 0) {
          console.log(`Migrated ${migratedCount} users...`);
        }
      } catch (error) {
        console.error(`Error migrating user ${user._id}:`, error);
      }
    }
    
    console.log(`Successfully migrated ${migratedCount} users`);
  } catch (error) {
    console.error('Error during user migration:', error);
  }
};

// Rollback function for payments (in case of issues)
const rollbackPayments = async () => {
  try {
    console.log('Starting payment rollback...');
    
    // Find all payments with the new generic fields
    const migratedPayments = await Payment.find({
      paymentGateway: 'stripe'
    });
    
    console.log(`Found ${migratedPayments.length} migrated payments to rollback`);
    
    let rolledBackCount = 0;
    
    for (const payment of migratedPayments) {
      try {
        // Restore Stripe-specific fields from generic fields
        if (payment.paymentIntentId) {
          payment.stripePaymentIntentId = payment.paymentIntentId;
        }
        
        if (payment.payoutId) {
          payment.stripePayoutId = payment.payoutId;
        }
        
        if (payment.refundId) {
          payment.stripeRefundId = payment.refundId;
        }
        
        if (payment.transferId) {
          payment.stripeTransferId = payment.transferId;
        }
        
        if (payment.providerAccountId) {
          payment.stripeConnectedAccountId = payment.providerAccountId;
        }
        
        // Restore Stripe-specific metadata
        if (payment.gatewayMetadata) {
          if (payment.gatewayMetadata.get('clientSecret')) {
            payment.stripePaymentIntentSecret = payment.gatewayMetadata.get('clientSecret');
          }
          
          if (payment.gatewayMetadata.get('chargeId')) {
            payment.stripeChargeId = payment.gatewayMetadata.get('chargeId');
          }
        }
        
        // Clear new fields
        payment.paymentGateway = undefined;
        payment.paymentMethodType = undefined;
        payment.paymentIntentId = undefined;
        payment.payoutId = undefined;
        payment.refundId = undefined;
        payment.transferId = undefined;
        payment.providerAccountId = undefined;
        payment.gatewayMetadata = undefined;
        
        // Save the updated payment
        await payment.save();
        rolledBackCount++;
        
        if (rolledBackCount % 100 === 0) {
          console.log(`Rolled back ${rolledBackCount} payments...`);
        }
      } catch (error) {
        console.error(`Error rolling back payment ${payment._id}:`, error);
      }
    }
    
    console.log(`Successfully rolled back ${rolledBackCount} payments`);
  } catch (error) {
    console.error('Error during payment rollback:', error);
  }
};

// Rollback function for users (in case of issues)
const rollbackUsers = async () => {
  try {
    console.log('Starting user rollback...');
    
    // Find all users with the new generic fields
    const migratedUsers = await User.find({
      paymentGateway: 'stripe'
    });
    
    console.log(`Found ${migratedUsers.length} migrated users to rollback`);
    
    let rolledBackCount = 0;
    
    for (const user of migratedUsers) {
      try {
        // Restore Stripe-specific fields from generic fields
        if (user.providerAccountId) {
          user.stripeAccountId = user.providerAccountId;
        }
        
        // Clear new fields
        user.paymentGateway = undefined;
        user.providerAccountId = undefined;
        
        // Save the updated user
        await user.save();
        rolledBackCount++;
        
        if (rolledBackCount % 100 === 0) {
          console.log(`Rolled back ${rolledBackCount} users...`);
        }
      } catch (error) {
        console.error(`Error rolling back user ${user._id}:`, error);
      }
    }
    
    console.log(`Successfully rolled back ${rolledBackCount} users`);
  } catch (error) {
    console.error('Error during user rollback:', error);
  }
};

// Main migration function
const runMigration = async () => {
  await connectDB();
  
  console.log('Starting full migration process...');
  
  // Run migrations
  await migrateUsers();
  await migratePayments();
  
  console.log('Migration process completed!');
  
  // Close the database connection
  await mongoose.connection.close();
  console.log('Database connection closed');
};

// Main rollback function
const runRollback = async () => {
  await connectDB();
  
  console.log('Starting full rollback process...');
  
  // Run rollbacks
  await rollbackPayments();
  await rollbackUsers();
  
  console.log('Rollback process completed!');
  
  // Close the database connection
  await mongoose.connection.close();
  console.log('Database connection closed');
};

// Run the appropriate function based on command line arguments
if (process.argv[2] === '--rollback') {
  runRollback().catch(console.error);
} else {
  runMigration().catch(console.error);
}