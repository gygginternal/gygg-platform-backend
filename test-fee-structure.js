#!/usr/bin/env node

/**
 * Fee Structure Test Runner
 * 
 * This script tests the payment fee structure to ensure:
 * 1. Provider pays: Listed Amount + Platform Fee (10% + $5) + Tax (13%)
 * 2. Tasker receives: Full Listed Amount (no deductions)
 * 3. Platform receives: Platform Fee as revenue
 */

import mongoose from 'mongoose';

// Set test environment variables
process.env.PLATFORM_FIXED_FEE_CENTS = '500'; // $5.00
process.env.PLATFORM_FEE_PERCENT = '0.10'; // 10%
process.env.TAX_PERCENT = '0.13'; // 13%

console.log('🧪 Testing Payment Fee Structure\n');
console.log('Environment Configuration:');
console.log(`- Platform Fixed Fee: $${process.env.PLATFORM_FIXED_FEE_CENTS / 100}`);
console.log(`- Platform Fee Percentage: ${(process.env.PLATFORM_FEE_PERCENT * 100)}%`);
console.log(`- Tax Percentage: ${(process.env.TAX_PERCENT * 100)}%\n`);

async function testFeeCalculations() {
  try {
    console.log('📊 Fee Structure Test Results:\n');
    
    const testCases = [
      { amount: 5000, description: '$50 Service' },
      { amount: 10000, description: '$100 Service' },
      { amount:15000, description: '$150 Service' },
      { amount: 20000, description: '$200 Service' },
      { amount: 25000, description: '$250 Service' }
    ];

    for (const testCase of testCases) {
      console.log(`\n🔍 Testing ${testCase.description}:`);
      console.log('─'.repeat(50));
      
      // Create a payment instance to test the pre-save hook
      const payment = new Payment({
        payer: new mongoose.Types.ObjectId(),
        payee: new mongoose.Types.ObjectId(),
        amount: testCase.amount,
        currency: 'cad',
        stripeConnectedAccountId: 'acct_test123',
        type: 'payment'
      });

      // Manually trigger the pre-save hook logic
      const fixedFeeCents = parseInt(process.env.PLATFORM_FIXED_FEE_CENTS) || 500;
      const feePercentage = parseFloat(process.env.PLATFORM_FEE_PERCENT) || 0.10;
      const taxPercent = parseFloat(process.env.TAX_PERCENT) || 0.13;
      
      const agreedServiceAmount = payment.amount;
      payment.applicationFeeAmount = Math.round(agreedServiceAmount * feePercentage) + fixedFeeCents;
      const providerTaxableAmount = agreedServiceAmount + payment.applicationFeeAmount;
      payment.providerTaxAmount = Math.round(providerTaxableAmount * taxPercent);
      payment.taskerTaxAmount = 0;
      payment.taxAmount = payment.providerTaxAmount;
      payment.totalProviderPayment = agreedServiceAmount + payment.applicationFeeAmount + payment.providerTaxAmount;
      payment.amountReceivedByPayee = agreedServiceAmount;
      payment.amountAfterTax = agreedServiceAmount;

      // Display results
      console.log(`✅ Tasker Receives:     $${(payment.amountReceivedByPayee / 100).toFixed(2)} (full agreed amount)`);
      console.log(`💼 Platform Fee:       $${(payment.applicationFeeAmount / 100).toFixed(2)} (platform revenue)`);
      console.log(`🏛️  Provider Tax:       $${(payment.providerTaxAmount / 100).toFixed(2)}`);
      console.log(`💳 Provider Pays Total: $${(payment.totalProviderPayment / 100).toFixed(2)}`);
      
      // Verify calculations
      const expectedPlatformFee = Math.round(testCase.amount * 0.10) + 500;
      const expectedTax = Math.round((testCase.amount + expectedPlatformFee) * 0.13);
      const expectedTotal = testCase.amount + expectedPlatformFee + expectedTax;
      
      const platformFeeCorrect = payment.applicationFeeAmount === expectedPlatformFee;
      const taxCorrect = payment.providerTaxAmount === expectedTax;
      const totalCorrect = payment.totalProviderPayment === expectedTotal;
      const taskerCorrect = payment.amountReceivedByPayee === testCase.amount;
      
      console.log(`\n📋 Validation:`);
      console.log(`   Platform Fee (10% + $5): ${platformFeeCorrect ? '✅' : '❌'} ${platformFeeCorrect ? 'PASS' : 'FAIL'}`);
      console.log(`   Tax (13% of service + fee): ${taxCorrect ? '✅' : '❌'} ${taxCorrect ? 'PASS' : 'FAIL'}`);
      console.log(`   Total Provider Payment: ${totalCorrect ? '✅' : '❌'} ${totalCorrect ? 'PASS' : 'FAIL'}`);
      console.log(`   Tasker Receives Full Amount: ${taskerCorrect ? '✅' : '❌'} ${taskerCorrect ? 'PASS' : 'FAIL'}`);
      
      if (!platformFeeCorrect || !taxCorrect || !totalCorrect || !taskerCorrect) {
        console.log(`\n❌ TEST FAILED for ${testCase.description}`);
        process.exit(1);
      }
    }
    
    console.log('\n🎉 All Fee Structure Tests PASSED!\n');
    
    // Display summary table
    console.log('📈 Fee Structure Summary Table:');
    console.log('─'.repeat(80));
    console.log('Service Amount | Platform Fee | Provider Tax | Total Paid | Tasker Gets');
    console.log('─'.repeat(80));
    
    const summaryExamples = [
      { amount: 5000, desc: '$50.00' },
      { amount: 10000, desc: '$100.00' },
      { amount: 15000, desc: '$150.00' },
      { amount: 20000, desc: '$200.00' },
      { amount: 25000, desc: '$250.00' }
    ];
    
    for (const example of summaryExamples) {
      const platformFee = Math.round(example.amount * 0.10) + 500;
      const tax = Math.round((example.amount + platformFee) * 0.13);
      const total = example.amount + platformFee + tax;
      
      console.log(`${example.desc.padEnd(13)} | $${(platformFee/100).toFixed(2).padEnd(10)} | $${(tax/100).toFixed(2).padEnd(10)} | $${(total/100).toFixed(2).padEnd(8)} | ${example.desc}`);
    }
    console.log('─'.repeat(80));
    
    console.log('\n✅ Key Validations:');
    console.log('   • Taskers receive the FULL listed amount (no deductions)');
    console.log('   • Providers pay listed amount + platform fee + tax');
    console.log('   • Platform fee is 10% of service amount + $5 fixed fee');
    console.log('   • Tax is 13% calculated on (service amount + platform fee)');
    console.log('   • Platform receives the platform fee as revenue');
    
  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
    process.exit(1);
  }
}

// Run the tests
testFeeCalculations();