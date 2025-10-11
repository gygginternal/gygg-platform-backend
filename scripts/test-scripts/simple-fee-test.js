#!/usr/bin/env node

/**
 * Simple Fee Structure Test
 * 
 * Tests the fee calculation logic without database dependencies
 */

// Set test environment variables
process.env.PLATFORM_FIXED_FEE_CENTS = '500'; // $5.00
process.env.PLATFORM_FEE_PERCENT = '0.10'; // 10%
process.env.TAX_PERCENT = '0.13'; // 13%

console.log('🧪 Testing Payment Fee Structure\n');
console.log('Environment Configuration:');
console.log(`- Platform Fixed Fee: $${process.env.PLATFORM_FIXED_FEE_CENTS / 100}`);
console.log(`- Platform Fee Percentage: ${(process.env.PLATFORM_FEE_PERCENT * 100)}%`);
console.log(`- Tax Percentage: ${(process.env.TAX_PERCENT * 100)}%\n`);

function calculateFees(serviceAmountCents) {
  const fixedFeeCents = parseInt(process.env.PLATFORM_FIXED_FEE_CENTS) || 500;
  const feePercentage = parseFloat(process.env.PLATFORM_FEE_PERCENT) || 0.10;
  const taxPercent = parseFloat(process.env.TAX_PERCENT) || 0.13;
  
  // Service amount (what tasker receives)
  const agreedServiceAmount = serviceAmountCents;
  
  // Platform fee calculation (percentage of service amount + fixed fee)
  const applicationFeeAmount = Math.round(agreedServiceAmount * feePercentage) + fixedFeeCents;
  
  // Provider pays tax on the total amount they pay (service + platform fee)
  const providerTaxableAmount = agreedServiceAmount + applicationFeeAmount;
  const providerTaxAmount = Math.round(providerTaxableAmount * taxPercent);
  
  // Tasker receives the full agreed amount (no deductions)
  const taskerTaxAmount = 0;
  
  // Total tax amount (only provider tax in this model)
  const taxAmount = providerTaxAmount;
  
  // Total amount provider pays (service amount + platform fee + tax)
  const totalProviderPayment = agreedServiceAmount + applicationFeeAmount + providerTaxAmount;
  
  // Amount tasker receives (the full agreed service amount - no fees deducted)
  const amountReceivedByPayee = agreedServiceAmount;
  
  return {
    serviceAmount: agreedServiceAmount,
    applicationFeeAmount,
    providerTaxAmount,
    taskerTaxAmount,
    taxAmount,
    totalProviderPayment,
    amountReceivedByPayee
  };
}

function testFeeCalculations() {
  console.log('📊 Fee Structure Test Results:\n');
  
  const testCases = [
    { amount: 5000, description: '$50 Service' },
    { amount: 10000, description: '$100 Service' },
    { amount: 15000, description: '$150 Service' },
    { amount: 20000, description: '$200 Service' },
    { amount: 25000, description: '$250 Service' }
  ];

  let allTestsPassed = true;

  for (const testCase of testCases) {
    console.log(`\n🔍 Testing ${testCase.description}:`);
    console.log('─'.repeat(50));
    
    const fees = calculateFees(testCase.amount);

    // Display results
    console.log(`✅ Tasker Receives:     $${(fees.amountReceivedByPayee / 100).toFixed(2)} (full agreed amount)`);
    console.log(`💼 Platform Fee:       $${(fees.applicationFeeAmount / 100).toFixed(2)} (platform revenue)`);
    console.log(`🏛️  Provider Tax:       $${(fees.providerTaxAmount / 100).toFixed(2)}`);
    console.log(`💳 Provider Pays Total: $${(fees.totalProviderPayment / 100).toFixed(2)}`);
    
    // Verify calculations
    const expectedPlatformFee = Math.round(testCase.amount * 0.10) + 500;
    const expectedTax = Math.round((testCase.amount + expectedPlatformFee) * 0.13);
    const expectedTotal = testCase.amount + expectedPlatformFee + expectedTax;
    
    const platformFeeCorrect = fees.applicationFeeAmount === expectedPlatformFee;
    const taxCorrect = fees.providerTaxAmount === expectedTax;
    const totalCorrect = fees.totalProviderPayment === expectedTotal;
    const taskerCorrect = fees.amountReceivedByPayee === testCase.amount;
    
    console.log(`\n📋 Validation:`);
    console.log(`   Platform Fee (10% + $5): ${platformFeeCorrect ? '✅' : '❌'} ${platformFeeCorrect ? 'PASS' : 'FAIL'}`);
    console.log(`   Tax (13% of service + fee): ${taxCorrect ? '✅' : '❌'} ${taxCorrect ? 'PASS' : 'FAIL'}`);
    console.log(`   Total Provider Payment: ${totalCorrect ? '✅' : '❌'} ${totalCorrect ? 'PASS' : 'FAIL'}`);
    console.log(`   Tasker Receives Full Amount: ${taskerCorrect ? '✅' : '❌'} ${taskerCorrect ? 'PASS' : 'FAIL'}`);
    
    if (!platformFeeCorrect || !taxCorrect || !totalCorrect || !taskerCorrect) {
      console.log(`\n❌ TEST FAILED for ${testCase.description}`);
      allTestsPassed = false;
    }
  }
  
  if (allTestsPassed) {
    console.log('\n🎉 All Fee Structure Tests PASSED!\n');
    
    // Display summary table
    console.log('📈 Fee Structure Summary Table:');
    console.log('─'.repeat(80));
    console.log('Service Amount | Platform Fee | Provider Tax | Total Paid | Tasker Gets');
    console.log('─'.repeat(80));
    
    for (const testCase of testCases) {
      const fees = calculateFees(testCase.amount);
      const serviceStr = `$${(testCase.amount / 100).toFixed(2)}`;
      const feeStr = `$${(fees.applicationFeeAmount / 100).toFixed(2)}`;
      const taxStr = `$${(fees.providerTaxAmount / 100).toFixed(2)}`;
      const totalStr = `$${(fees.totalProviderPayment / 100).toFixed(2)}`;
      const taskerStr = `$${(fees.amountReceivedByPayee / 100).toFixed(2)}`;
      
      console.log(`${serviceStr.padEnd(13)} | ${feeStr.padEnd(11)} | ${taxStr.padEnd(11)} | ${totalStr.padEnd(9)} | ${taskerStr}`);
    }
    console.log('─'.repeat(80));
    
    console.log('\n✅ Key Validations:');
    console.log('   • Taskers receive the FULL listed amount (no deductions)');
    console.log('   • Providers pay listed amount + platform fee + tax');
    console.log('   • Platform fee is 10% of service amount + $5 fixed fee');
    console.log('   • Tax is 13% calculated on (service amount + platform fee)');
    console.log('   • Platform receives the platform fee as revenue');
    
    console.log('\n🔍 Detailed Example for $100 Service:');
    const example = calculateFees(10000);
    console.log(`   1. Service Amount: $${(example.serviceAmount / 100).toFixed(2)}`);
    console.log(`   2. Platform Fee: 10% of $100 + $5 = $10 + $5 = $${(example.applicationFeeAmount / 100).toFixed(2)}`);
    console.log(`   3. Taxable Amount: $100 + $15 = $115`);
    console.log(`   4. Provider Tax: 13% of $115 = $${(example.providerTaxAmount / 100).toFixed(2)}`);
    console.log(`   5. Provider Pays Total: $100 + $15 + $14.95 = $${(example.totalProviderPayment / 100).toFixed(2)}`);
    console.log(`   6. Tasker Receives: $${(example.amountReceivedByPayee / 100).toFixed(2)} (full service amount)`);
    
    return true;
  } else {
    console.log('\n❌ Some tests failed!');
    return false;
  }
}

// Run the tests
const success = testFeeCalculations();
process.exit(success ? 0 : 1);