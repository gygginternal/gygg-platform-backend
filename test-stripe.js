import dotenv from "dotenv";
import Stripe from "stripe";

// Load environment variables
dotenv.config({ path: "./.env" });

console.log("Stripe Secret Key:", process.env.STRIPE_SECRET_KEY);
console.log("Key length:", process.env.STRIPE_SECRET_KEY?.length);

try {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  console.log("Stripe initialized successfully");
  
  // Test a simple API call
  const account = await stripe.accounts.retrieve('acct_test_tasker');
  console.log("Test account retrieved:", account.id);
} catch (error) {
  console.error("Stripe error:", error.message);
  console.error("Error type:", error.type);
  console.error("Error code:", error.code);
} 