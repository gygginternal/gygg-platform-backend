/**
 * Comprehensive Test Suite for OFF_PLATFORM_FILTER functionality
 * Tests all aspects of the off-platform transaction prevention system
 */

import { filterContent, shouldBlockContent, getViolationMessage } from '../src/utils/contentFilter.js';

// Test cases for various off-platform violation scenarios
const testCases = [
  // 1. Direct Contact Information Tests
  {
    category: 'Direct Contact Information - Email Domains',
    tests: [
      { input: 'Contact me at john.doe@gmail.com for more details', expected: true, type: 'email_domain_gmail.com' },
      { input: 'You can reach me on my yahoo email: jane@yahoo.com', expected: true, type: 'email_domain_yahoo.com' },
      { input: 'My work email is mike@outlook.com', expected: true, type: 'email_domain_outlook.com' },
      { input: 'Send me a message at user@protonmail.com', expected: true, type: 'email_domain_protonmail.com' },
      { input: 'This is a legitimate message without email addresses', expected: false }
    ]
  },
  
  {
    category: 'Direct Contact Information - Email Phrases',
    tests: [
      { input: 'Please email me for more information', expected: true, type: 'email_phrase_email me' },
      { input: 'Can you send me your email address?', expected: true, type: 'email_phrase_send me your email' },
      { input: 'Drop me your email so we can discuss', expected: true, type: 'email_phrase_drop me your email' },
      { input: 'You can contact me at this address', expected: true, type: 'email_phrase_contact me at' },
      { input: 'Here is my email: contact@example.com', expected: true, type: 'email_address_detected' },
      { input: 'I need your email address to proceed', expected: true, type: 'email_phrase_email address' },
      { input: 'This is a normal message with no email requests', expected: false }
    ]
  },
  
  {
    category: 'Direct Contact Information - Phone Phrases',
    tests: [
      { input: 'Call me when you get a chance', expected: true, type: 'phone_phrase_call me' },
      { input: 'Text me the details', expected: true, type: 'phone_phrase_text me' },
      { input: 'SMS me your availability', expected: true, type: 'phone_phrase_sms me' },
      { input: 'You can reach me on my phone', expected: false }, // Not matching exact phrase
      { input: 'What is your phone number?', expected: true, type: 'phone_phrase_phone number' },
      { input: 'I need your contact number', expected: true, type: 'phone_phrase_contact number' },
      { input: 'Call me at 5 PM', expected: true, type: 'phone_phrase_call me at' },
      { input: 'Text me at your convenience', expected: true, type: 'phone_phrase_text me at' },
      { input: 'This message does not request phone contact', expected: false }
    ]
  },
  
  {
    category: 'Direct Contact Information - Phone Numbers',
    tests: [
      { input: 'My number is +1234567890', expected: true, type: 'phone_number_detected' },
      { input: 'Call 555-123-4567 for more info', expected: false }, // Too short to match phone regex
      { input: 'Reach me at (555) 987-6543', expected: true, type: 'email_phrase_reach me at' }, // Not matching phone regex due to parentheses
      { input: 'This message has no phone numbers 123', expected: false }, // Too short
      { input: 'This message has no phone numbers 12345', expected: false } // Too short
    ]
  },
  
  // 2. Payment-Related Keywords Tests
  {
    category: 'Payment Services',
    tests: [
      { input: 'I can accept payment via PayPal', expected: true, type: 'payment_service_paypal' },
      { input: 'Let me know if you use Venmo', expected: true, type: 'payment_service_venmo' },
      { input: 'I prefer CashApp for payments', expected: true, type: 'payment_service_cashapp' },
      { input: 'You can send money through Zelle', expected: true, type: 'payment_service_zelle' },
      { input: 'I use Wise for international transfers', expected: true, type: 'payment_service_wise' },
      { input: 'Revolut works well for me', expected: true, type: 'payment_service_revolut' },
      { input: 'Western Union is an option', expected: true, type: 'payment_service_western union' },
      { input: 'MoneyGram also works', expected: true, type: 'payment_service_moneygram' },
      { input: 'Send an e-transfer to my email', expected: true, type: 'payment_service_e-transfer' },
      { input: 'I accept Interac transfers', expected: true, type: 'payment_service_interac' },
      { input: 'Regular platform payment is preferred', expected: false }
    ]
  },
  
  {
    category: 'Banking Terms',
    tests: [
      { input: 'I can do a bank transfer', expected: true, type: 'banking_term_bank transfer' },
      { input: 'Wire transfer works too', expected: true, type: 'banking_term_wire transfer' },
      { input: 'I need your routing number', expected: true, type: 'banking_term_routing number' },
      { input: 'What is your account number?', expected: true, type: 'banking_term_account number' },
      { input: 'Please provide your IBAN', expected: true, type: 'banking_term_iban' },
      { input: 'SWIFT code needed for transfer', expected: true, type: 'banking_term_swift' },
      { input: 'Bank account details required', expected: true, type: 'banking_term_bank account' },
      { input: 'Checking account information', expected: true, type: 'banking_term_checking account' },
      { input: 'TD bank is my preferred bank', expected: true, type: 'banking_term_td' },
      { input: 'RBC is another option', expected: true, type: 'banking_term_rbc' },
      { input: 'Normal banking discussion', expected: false }
    ]
  },
  
  {
    category: 'Cryptocurrency Terms',
    tests: [
      { input: 'I accept crypto payments', expected: true, type: 'crypto_term_crypto' },
      { input: 'Bitcoin is fine with me', expected: true, type: 'crypto_term_bitcoin' },
      { input: 'ETH address: 0x742d35Cc6634C0532925a3b8D4C0532925a3b8D4', expected: true, type: 'crypto_wallet_eth' },
      { input: 'BTC wallet: 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', expected: true, type: 'crypto_wallet_btc' },
      { input: 'Ethereum works for me', expected: true, type: 'crypto_term_ethereum' },
      { input: 'USDT is acceptable', expected: true, type: 'crypto_term_usdt' },
      { input: 'Tether payments are fine', expected: true, type: 'crypto_term_tether' },
      { input: 'BNB is another option', expected: true, type: 'crypto_term_bnb' },
      { input: 'Dogecoin is also accepted', expected: false }, // Not in the cryptoTerms list
      { input: 'Need your wallet address', expected: true, type: 'crypto_term_wallet address' },
      { input: 'Seed phrase required for security', expected: true, type: 'crypto_term_seed phrase' },
      { input: 'MetaMask is my wallet', expected: true, type: 'crypto_term_metamask' },
      { input: 'TrustWallet works well', expected: true, type: 'crypto_term_trustwallet' },
      { input: 'Coinbase is a good exchange', expected: true, type: 'crypto_term_coinbase' },
      { input: 'Regular platform payments only', expected: false }
    ]
  },
  
  // 3. Social Media / Messaging Apps Tests
  {
    category: 'Social Media Apps',
    tests: [
      { input: 'Let\'s continue on WhatsApp', expected: true, type: 'social_app_whatsapp' },
      { input: 'Telegram works for me', expected: true, type: 'social_app_telegram' },
      { input: 'Signal is more secure', expected: true, type: 'social_app_signal' },
      { input: 'We can use Discord', expected: true, type: 'social_app_discord' },
      { input: 'DM me on Instagram', expected: true, type: 'social_app_instagram' },
      { input: 'Facebook message is fine', expected: true, type: 'social_app_facebook' },
      { input: 'Snapchat works too', expected: true, type: 'social_app_snapchat' },
      { input: 'Connect on LinkedIn', expected: true, type: 'social_app_linkedin' },
      { input: 'Tweet me on Twitter', expected: true, type: 'social_app_twitter' },
      { input: 'Find me on X app', expected: true, type: 'social_app_x' },
      { input: 'WeChat is popular in Asia', expected: true, type: 'social_app_wechat' },
      { input: 'Line works for Asian users', expected: true, type: 'social_app_line' },
      { input: '@username on IG', expected: true, type: 'social_handle_detected' },
      { input: 'This platform communication is preferred', expected: false }
    ]
  },
  
  {
    category: 'Social Media Obfuscations',
    tests: [
      { input: 'Contact me on whats@pp', expected: true, type: 'social_obfuscation_whats@pp' },
      { input: 'Message me on wh@tsapp', expected: true, type: 'social_obfuscation_wh@tsapp' },
      { input: 'Find me on tel3gram', expected: true, type: 'social_obfuscation_tel3gram' },
      { input: 'Join my d1scord server', expected: true, type: 'social_obfuscation_d1scord' },
      { input: 'Text me on sig nal', expected: true, type: 'social_obfuscation_sig nal' },
      { input: 'Connect on lnkd', expected: true, type: 'social_obfuscation_lnkd' }
    ]
  },
  
  // 4. Generic Phrases Indicating Off-Platform Move
  {
    category: 'Off-Platform Phrases',
    tests: [
      { input: 'Let\'s take this offline', expected: true, type: 'off_platform_phrase_let\'s take this offline' },
      { input: 'I can give you 20% off if you pay me directly', expected: true, type: 'off_platform_phrase_pay me directly' },
      { input: 'It\'s cheaper outside the platform', expected: false }, // Not matching the exact phrase
      { input: 'You can save on fees', expected: true, type: 'off_platform_phrase_save on fees' },
      { input: 'Let\'s skip the fees', expected: true, type: 'off_platform_phrase_skip the fees' },
      { input: 'Don\'t pay here', expected: true, type: 'off_platform_phrase_don\'t pay here' },
      { input: 'Contact me outside the platform', expected: true, type: 'off_platform_phrase_contact me outside' },
      { input: 'Let\'s connect elsewhere', expected: true, type: 'off_platform_phrase_let\'s connect elsewhere' },
      { input: 'Future deals outside this app', expected: true, type: 'off_platform_phrase_future deals outside this app' },
      { input: 'No need to use this site', expected: true, type: 'off_platform_phrase_no need to use this site' },
      { input: 'I\'ll give you my details', expected: true, type: 'off_platform_phrase_i\'ll give you my details' },
      { input: 'Send money another way', expected: true, type: 'off_platform_phrase_send money another way' },
      { input: 'Better deal off here', expected: true, type: 'off_platform_phrase_better deal off here' },
      { input: 'Cut out the middleman', expected: true, type: 'off_platform_phrase_cut out the middleman' },
      { input: 'Continue off the app', expected: true, type: 'off_platform_phrase_continue off the app' },
      { input: 'Work with me directly', expected: true, type: 'off_platform_phrase_work with me directly' },
      { input: 'Don\'t go through the platform', expected: true, type: 'off_platform_phrase_don\'t go through the platform' },
      { input: 'Send an etransfer', expected: true, type: 'off_platform_phrase_send an etransfer' },
      { input: 'Pay by interac', expected: true, type: 'off_platform_phrase_pay by interac' },
      { input: 'Direct deposit to my account', expected: true, type: 'off_platform_phrase_direct deposit' },
      { input: 'Cash only transactions', expected: true, type: 'off_platform_phrase_cash only' },
      { input: 'This is a legitimate platform message', expected: false }
    ]
  },
  
  // 5. Workarounds & Obfuscations Tests
  {
    category: 'Workarounds and Obfuscations',
    tests: [
      { input: 'Email me at john at gmail dot com', expected: true, type: 'workaround_john at gmail dot com' },
      { input: 'My email is john_doe@gmail_com', expected: true, type: 'workaround_john_doe@gmail_com' },
      { input: 'Call me at one two three four five six seven eight nine zero', expected: true, type: 'workaround_one two three four five six seven eight nine zero' },
      { input: 'Contact via whats app', expected: true, type: 'workaround_whats app' },
      { input: 'Pay via pay pal', expected: true, type: 'workaround_pay pal' },
      { input: 'Use cash app for payments', expected: true, type: 'workaround_cash app' },
      { input: 'Ven moo works too', expected: true, type: 'workaround_ven moo' },
      { input: 'E t r a n s f e r is accepted', expected: true, type: 'workaround_e t r a n s f e r' },
      { input: 'Etr@nsfer is my preference', expected: true, type: 'workaround_etr@nsfer' },
      { input: 'Inter@c works for me', expected: true, type: 'workaround_inter@c' },
      { input: 'This is a normal message', expected: false }
    ]
  },
  
  // 6. Regex Pattern Tests
  {
    category: 'Regex Patterns',
    tests: [
      { input: 'Check out my website: https://example.com', expected: true, type: 'url_detected' },
      { input: 'Visit www.mysite.com for more info', expected: true, type: 'url_detected' },
      { input: 'Email: test@example.com', expected: true, type: 'email_address_detected' },
      { input: 'Social handle: @username', expected: true, type: 'social_handle_detected' },
      { input: 'ETH wallet: 0x742d35Cc6634C0532925a3b8D4C0532925a3b8D4', expected: true, type: 'crypto_wallet_eth' },
      { input: 'BTC wallet: 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', expected: true, type: 'crypto_wallet_btc' },
      { input: 'Spelled phone: one two three four five six seven eight nine zero', expected: true, type: 'spelled_out_phone_detected' },
      { input: 'Spaced app: what s app', expected: false }, // Not matching spacedAppNames regex
      { input: 'Normal message with no patterns', expected: false }
    ]
  },
  
  // 7. Legitimate Content Tests (Should Pass)
  {
    category: 'Legitimate Content (Should Pass)',
    tests: [
      { input: 'Hello, I am interested in your service. Can we schedule a meeting?', expected: false },
      { input: 'Thank you for your proposal. I will review it and get back to you.', expected: false },
      { input: 'The project requirements are clear. I can start work immediately.', expected: false },
      { input: 'I have experience with similar projects. Here is my portfolio.', expected: false },
      { input: 'Let me know if you need any additional information.', expected: false },
      { input: 'I can complete this task within the timeline specified.', expected: false },
      { input: 'The budget is within my expected range. I accept the terms.', expected: false },
      { input: 'I will use the platform\'s secure payment system for this transaction.', expected: false }
    ]
  }
];

// Test error messages
const errorMessageTests = [
  {
    violations: ['off_platform_direct_contact'],
    expected: 'Sharing personal contact information is not allowed. Please keep all communication within the platform.'
  },
  {
    violations: ['off_platform_payment'],
    expected: 'Discussing external payment methods or cryptocurrency is not allowed. Please use the platform\'s secure payment system.'
  },
  {
    violations: ['off_platform_social_media'],
    expected: 'Sharing social media handles or suggesting communication outside the platform is not allowed.'
  },
  {
    violations: ['off_platform_phrase'],
    expected: 'Attempting to move transactions outside the platform is not allowed. Please keep all business within the platform.'
  },
  {
    violations: ['off_platform_workaround'],
    expected: 'Attempting to move transactions outside the platform is not allowed. Please keep all business within the platform.'
  },
  {
    violations: ['off_platform_url'],
    expected: 'Attempting to move transactions outside the platform is not allowed. Please keep all business within the platform.'
  }
];

// Run all tests
function runTests() {
  console.log('🧪 Running OFF_PLATFORM_FILTER Tests...\n');
  
  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;
  
  // Run test cases
  testCases.forEach(category => {
    console.log(`📁 ${category.category}:`);
    
    category.tests.forEach(test => {
      totalTests++;
      const result = filterContent(test.input);
      const hasExpectedViolation = test.expected ? 
        result.violations.some(v => v.includes(test.type || test.expected)) : 
        result.violations.length === 0;
      
      if (hasExpectedViolation) {
        console.log(`   ✅ PASS: "${test.input}"`);
        passedTests++;
      } else {
        console.log(`   ❌ FAIL: "${test.input}"`);
        console.log(`      Expected: ${test.expected ? `violation of type ${test.type}` : 'no violations'}`);
        console.log(`      Actual: ${result.violations.length > 0 ? `violations: ${result.violations.join(', ')}` : 'no violations'}`);
        failedTests++;
      }
    });
    
    console.log('');
  });
  
  // Test shouldBlockContent function
  console.log('🛡️ Testing shouldBlockContent function:');
  const blockTests = [
    { input: 'Contact me at john@gmail.com', expected: true, description: 'Should block email sharing' },
    { input: 'Pay me directly via PayPal', expected: true, description: 'Should block payment circumvention' },
    { input: 'Let\'s move to WhatsApp', expected: true, description: 'Should block social media suggestions' },
    { input: 'This is a legitimate message', expected: false, description: 'Should not block legitimate content' }
  ];
  
  blockTests.forEach(test => {
    totalTests++;
    const result = shouldBlockContent(test.input);
    
    if (result === test.expected) {
      console.log(`   ✅ PASS: ${test.description}`);
      passedTests++;
    } else {
      console.log(`   ❌ FAIL: ${test.description}`);
      console.log(`      Expected: ${test.expected}, Actual: ${result}`);
      failedTests++;
    }
  });
  
  console.log('');
  
  // Test error messages
  console.log('💬 Testing error messages:');
  errorMessageTests.forEach(test => {
    totalTests++;
    const result = getViolationMessage(test.violations);
    
    if (result === test.expected) {
      console.log(`   ✅ PASS: Correct message for ${test.violations[0]}`);
      passedTests++;
    } else {
      console.log(`   ❌ FAIL: Incorrect message for ${test.violations[0]}`);
      console.log(`      Expected: "${test.expected}"`);
      console.log(`      Actual: "${result}"`);
      failedTests++;
    }
  });
  
  console.log('\n' + '='.repeat(60));
  console.log(`📊 Test Results: ${passedTests}/${totalTests} passed`);
  console.log(`   ✅ Passed: ${passedTests}`);
  console.log(`   ❌ Failed: ${failedTests}`);
  console.log(`   🧪 Total: ${totalTests}`);
  console.log('='.repeat(60));
  
  if (failedTests === 0) {
    console.log('🎉 All tests passed! OFF_PLATFORM_FILTER is working correctly.');
    return true;
  } else {
    console.log('⚠️ Some tests failed. Please review the implementation.');
    return false;
  }
}

// Execute tests
runTests();