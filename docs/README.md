# Gygg Platform Payment System Documentation

This directory contains comprehensive documentation for the Gygg platform's payment system implementation.

## Documentation Files

### 1. [PAYMENT_SYSTEM_DOCUMENTATION.md](PAYMENT_SYSTEM_DOCUMENTATION.md)
Detailed technical documentation covering:
- System architecture and components
- Payment models and fee structures
- API endpoints and frontend components
- Testing guidelines and troubleshooting

### 2. [PAYMENT_TESTS_FIX_GUIDE.md](PAYMENT_TESTS_FIX_GUIDE.md)
Step-by-step guide to fixing failing payment tests:
- Rate limiting issues
- Missing dependencies
- Assertion syntax problems
- Import path errors

### 3. [PAYMENT_SYSTEM_QUICK_START.md](PAYMENT_SYSTEM_QUICK_START.md)
Quick start guide for new developers:
- Environment setup
- Key files and components
- Common operations
- Development tips

## System Overview

The Gygg platform implements a dual payment system supporting both **Stripe** (global) and **Nuvei** (Canadian market focused) payment providers. This allows the platform to operate in both international and Canadian markets with appropriate payment solutions for each region.

### Key Features
- **Dual Payment Systems**: Independent Stripe and Nuvei implementations
- **Unified Dashboard**: Single view showing payments from both systems
- **Flexible Fee Structure**: Configurable platform fees and taxes
- **Comprehensive Error Handling**: Robust error handling for both systems
- **Secure Transactions**: Proper authorization and data isolation

### Fee Structure
- **Taskers receive**: Full agreed service amount (no deductions)
- **Platform receives**: Percentage-based fee + fixed fee
- **Providers pay**: Service amount + platform fee + applicable taxes

## Usage

To fix the failing tests, follow the instructions in [PAYMENT_TESTS_FIX_GUIDE.md](PAYMENT_TESTS_FIX_GUIDE.md).

For understanding the system architecture and implementation details, refer to [PAYMENT_SYSTEM_DOCUMENTATION.md](PAYMENT_SYSTEM_DOCUMENTATION.md).

For new developers getting started with the payment system, begin with [PAYMENT_SYSTEM_QUICK_START.md](PAYMENT_SYSTEM_QUICK_START.md).
