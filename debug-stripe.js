import dotenv from "dotenv";
import Stripe from "stripe";
import User from "./src/models/User.js";
import connectDB from "./src/config/db.js";

// Load environment variables
dotenv.config({ path: "./.env" });

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function testStripeAccountStatus() {
  try {
    await connectDB();
    
    // Find a user with a stripeAccountId
    const user = await User.findOne({ stripeAccountId: { $exists: true, $ne: null } });
    
    if (!user) {
      console.log("No users found with stripeAccountId");
      return;
    }
    
    console.log("Found user:", user.email);
    console.log("Stripe Account ID:", user.stripeAccountId);
    
    // Test the Stripe account retrieval
    try {
      const account = await stripe.accounts.retrieve(user.stripeAccountId);
      console.log("Stripe account retrieved successfully:", account.id);
      console.log("Account details:", {
        payouts_enabled: account.payouts_enabled,
        details_submitted: account.details_submitted,
        charges_enabled: account.charges_enabled,
        capabilities: account.capabilities
      });
    } catch (stripeError) {
      console.error("Stripe API error:", stripeError.message);
      console.error("Error type:", stripeError.type);
      console.error("Error code:", stripeError.code);
    }
    
  } catch (error) {
    console.error("Database error:", error);
  } finally {
    process.exit(0);
  }
}

testStripeAccountStatus(); 