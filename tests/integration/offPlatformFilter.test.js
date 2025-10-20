/**
 * Jest Test Suite for OFF_PLATFORM_FILTER functionality
 * Tests all aspects of the off-platform transaction prevention system
 */

import { filterContent, shouldBlockContent, getViolationMessage } from '../../src/utils/contentFilter.js';

describe('OFF_PLATFORM_FILTER Tests', () => {
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
    
    // 2. Phone Number Tests
    {
      category: 'Phone Numbers',
      tests: [
        { input: 'Call me at 555-123-4567', expected: true, type: 'phone_number' },
        { input: 'Text me: +1 (555) 987-6543', expected: true, type: 'phone_number' },
        { input: 'My cell is 555.123.4567', expected: true, type: 'phone_number' },
        { input: 'Reach me at (555) 123 4567', expected: true, type: 'phone_number' },
        { input: 'This is a normal message with no email requests', expected: false }
      ]
    },
    
    // 3. Instant Messaging Platform Tests
    {
      category: 'Instant Messaging Platforms',
      tests: [
        { input: 'DM me on WhatsApp', expected: true, type: 'im_platform_whatsapp' },
        { input: 'Message me on Telegram', expected: true, type: 'im_platform_telegram' },
        { input: 'Contact me on Signal', expected: true, type: 'im_platform_signal' },
        { input: 'Find me on Discord', expected: true, type: 'im_platform_discord' },
        { input: 'SMS me your availability', expected: true, type: 'phone_phrase_sms me' },
        { input: 'This is a legitimate platform message', expected: false }
      ]
    },
    
    // 4. Cryptocurrency References Tests
    {
      category: 'Cryptocurrency References',
      tests: [
        { input: 'I accept Bitcoin payments', expected: true, type: 'crypto_term_bitcoin' },
        { input: 'Send ETH to this address', expected: true, type: 'crypto_term_eth' },
        { input: 'Pay with Litecoin', expected: true, type: 'crypto_term_litecoin' },
        { input: 'Use Dogecoin for transactions', expected: true, type: 'crypto_term_dogecoin' },
        { input: 'Bitcoin is fine with me', expected: true, type: 'crypto_term_bitcoin' },
        { input: 'Seed phrase required for security', expected: true, type: 'crypto_term_seed phrase' },
        { input: 'Wallet address needed', expected: true, type: 'crypto_term_wallet address' },
        { input: 'Private key sharing', expected: true, type: 'crypto_term_private key' },
        { input: 'Normal platform payment preferred', expected: false }
      ]
    },
    
    // 5. Social Media Platform Tests
    {
      category: 'Social Media Platforms',
      tests: [
        { input: 'Follow me on Instagram @username', expected: true, type: 'social_app_instagram' },
        { input: 'Connect on Facebook', expected: true, type: 'social_app_facebook' },
        { input: 'Tweet me on Twitter', expected: true, type: 'social_app_twitter' },
        { input: 'Add me on LinkedIn', expected: true, type: 'social_app_linkedin' },
        { input: 'Snapchat me for details', expected: true, type: 'social_app_snapchat' },
        { input: 'Regular platform communication', expected: false }
      ]
    },
    
    // 6. Off-Platform Transaction Phrases Tests
    {
      category: 'Off-Platform Transaction Phrases',
      tests: [
        { input: 'Let\'s take this offline', expected: true, type: 'off_platform_phrase_offline' },
        { input: 'I can give you 20% off if you pay me directly', expected: true, type: 'off_platform_phrase_pay me directly' },
        { input: 'It\'s cheaper outside the platform', expected: true, type: 'off_platform_phrase_outside the platform' },
        { input: 'You can save on fees', expected: true, type: 'off_platform_phrase_save on fees' },
        { input: 'Let\'s skip the fees', expected: true, type: 'off_platform_phrase_skip the fees' },
        { input: 'Don\'t pay here', expected: true, type: 'off_platform_phrase_don\'t pay here' },
        { input: 'Contact me outside the platform', expected: true, type: 'off_platform_phrase_outside the platform' },
        { input: 'Let\'s connect elsewhere', expected: true, type: 'off_platform_phrase_elsewhere' },
        { input: 'Future deals outside this app', expected: true, type: 'off_platform_phrase_outside this app' },
        { input: 'No need to use this site', expected: true, type: 'off_platform_phrase_no need to use this site' },
        { input: 'Work with me directly', expected: true, type: 'off_platform_phrase_work with me directly' },
        { input: 'Direct deposit to my account', expected: true, type: 'off_platform_phrase_direct deposit' },
        { input: 'This is a legitimate platform message', expected: false }
      ]
    },
    
    // 7. URL Detection Tests
    {
      category: 'URL and Website Detection',
      tests: [
        { input: 'Check out my website: https://example.com', expected: true, type: 'url_detected' },
        { input: 'Visit www.mysite.com for more info', expected: true, type: 'url_detected' },
        { input: 'Email: test@example.com', expected: true, type: 'email_address_detected' },
        { input: 'Go to http://mysite.org', expected: true, type: 'url_detected' },
        { input: 'Normal message with no patterns', expected: false }
      ]
    },
    
    // 8. Legitimate Content Tests (Should Pass)
    {
      category: 'Legitimate Content (Should Pass)',
      tests: [
        { input: 'Thank you for your proposal. I will review it and get back to you.', expected: false },
        { input: 'I have experience with similar projects. Here is my portfolio.', expected: false },
        { input: 'Let me know if you need any additional information.', expected: false },
        { input: 'I can complete this task within the timeline specified.', expected: false },
        { input: 'The budget is within my expected range. I accept the terms.', expected: false },
        { input: 'This platform communication is preferred', expected: false }
      ]
    }
  ];
  
  // Block content tests
  const blockTests = [
    { input: 'This is a legitimate message', expected: false, description: 'Should not block legitimate content' },
    { input: 'Contact me at john.doe@gmail.com', expected: true, description: 'Should block email domain content' },
    { input: 'Call me at 555-123-4567', expected: true, description: 'Should block phone number content' },
    { input: 'DM me on WhatsApp', expected: true, description: 'Should block IM platform content' },
    { input: 'I accept Bitcoin', expected: true, description: 'Should block cryptocurrency content' },
    { input: 'Follow me on Instagram', expected: true, description: 'Should block social media content' },
    { input: 'Let\'s take this offline', expected: true, description: 'Should block off-platform content' },
    { input: 'Check out https://mysite.com', expected: true, description: 'Should block URL content' }
  ];
  
  // Error message tests
  const errorMessageTests = [
    {
      violations: ['email_domain_gmail.com'],
      expected: 'Sharing personal contact information is not allowed. Please keep all communication within the platform.'
    },
    {
      violations: ['phone_number'],
      expected: 'Sharing personal contact information is not allowed. Please keep all communication within the platform.'
    },
    {
      violations: ['im_platform_whatsapp'],
      expected: 'Attempting to move transactions outside the platform is not allowed. Please keep all business within the platform.'
    },
    {
      violations: ['crypto_term_bitcoin'],
      expected: 'Attempting to move transactions outside the platform is not allowed. Please keep all business within the platform.'
    },
    {
      violations: ['social_app_instagram'],
      expected: 'Attempting to move transactions outside the platform is not allowed. Please keep all business within the platform.'
    },
    {
      violations: ['off_platform_phrase_offline'],
      expected: 'Attempting to move transactions outside the platform is not allowed. Please keep all business within the platform.'
    },
    {
      violations: ['url_detected'],
      expected: 'Attempting to move transactions outside the platform is not allowed. Please keep all business within the platform.'
    }
  ];

  describe('Content Filtering Tests', () => {
    testCases.forEach(category => {
      describe(category.category, () => {
        category.tests.forEach((test, index) => {
          it(`should ${test.expected ? 'block' : 'allow'} content: "${test.input.substring(0, 30)}..."`, () => {
            const result = filterContent(test.input);
            const hasViolation = result.violations.length > 0;
            
            expect(hasViolation).toBe(test.expected);
            
            if (test.expected && test.type) {
              expect(result.violations.some(v => v.includes(test.type))).toBe(true);
            }
          });
        });
      });
    });
  });
  
  describe('Block Content Tests', () => {
    blockTests.forEach((test, index) => {
      it(test.description, () => {
        const result = shouldBlockContent(test.input);
        expect(result).toBe(test.expected);
      });
    });
  });
  
  describe('Error Message Tests', () => {
    errorMessageTests.forEach((test, index) => {
      it(`should return correct message for ${test.violations[0]}`, () => {
        const result = getViolationMessage(test.violations);
        expect(result).toBe(test.expected);
      });
    });
  });
});