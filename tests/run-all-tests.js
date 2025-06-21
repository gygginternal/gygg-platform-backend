#!/usr/bin/env node

/**
 * Comprehensive Test Runner for Gygg Platform Backend
 * 
 * This script runs all API endpoint tests in the correct order
 * to ensure proper test isolation and database setup.
 */

import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const testFiles = [
  'tests/setup.js',
  'tests/payment.test.js',
  'tests/auth.test.js',
  'tests/user.test.js',
  'tests/gig.test.js',
  'tests/post.test.js',
  'tests/contract.test.js',
  'tests/chat.test.js',
  'tests/review.test.js',
  'tests/notification.test.js'
];

console.log('🚀 Starting comprehensive API tests for Gygg Platform Backend...\n');

try {
  // Run all tests using Jest
  const command = `npx jest ${testFiles.join(' ')} --verbose --detectOpenHandles --forceExit`;
  
  console.log('Running tests with command:', command);
  console.log('='.repeat(80));
  
  execSync(command, { 
    stdio: 'inherit',
    cwd: join(__dirname, '..')
  });
  
  console.log('\n' + '='.repeat(80));
  console.log('✅ All tests completed successfully!');
  
} catch (error) {
  console.error('\n❌ Test execution failed:', error.message);
  process.exit(1);
} 