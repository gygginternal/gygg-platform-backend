# Payment Processing with Stripe and Interac in Canada

## Fee Structure

### Stripe Fees (Credit/Debit Cards)
1. **Transaction Fees**:
   - 2.9% + $0.30 CAD per successful card charge (standard rate)
   - For Canadian businesses processing Canadian cards

2. **International Cards**:
   - 2.9% + $0.30 CAD + 1.50% for international cards

3. **Refund Fees**:
   - No fee to refund a charge, but the original card fee is not returned

4. **Platform Fees (Gygg's Revenue)**:
   - 10% of service amount + $5.00 fixed fee (configurable)
   - This is the platform's revenue and is separate from Stripe fees

### Interac e-Transfer Fees
1. **Transaction Fees**:
   - $1.00 per transfer (charged to the sender)
   - Some banks offer free Interac e-Transfers as part of premium packages

2. **Platform Fees (Gygg's Revenue)**:
   - Same as Stripe: 10% of service amount + $5.00 fixed fee
   - Note: Interac doesn't charge a percentage, only a flat fee

## Tax Structure

### GST/HST Application
1. **Provider Pays Tax**:
   - Providers pay 5% GST or HST (depending on province) on the total amount they pay
   - Total amount = Service amount + Platform fee + Interac/Stripe fee

2. **Tasker Receives**:
   - Taskers receive the full agreed service amount
   - No tax is deducted from their payment

### Example Tax Calculation (Ontario - 13% HST)
For a $100 service:
- Service amount: $100.00
- Platform fee (10% + $5): $15.00
- Stripe fee (2.9% + $0.30): $3.34
- Total provider payment: $118.34
- HST (13% on $118.34): $15.38
- Total provider cost: $133.72
- Tasker receives: $100.00

For Interac:
- Service amount: $100.00
- Platform fee (10% + $5): $15.00
- Interac fee: $1.00
- Total provider payment: $116.00
- HST (13% on $116.00): $15.08
- Total provider cost: $131.08
- Tasker receives: $100.00

## Payment Flow

### Stripe (Credit/Debit Card)
1. Provider selects Stripe payment method
2. System creates a Stripe PaymentIntent
3. Provider enters card details and confirms payment
4. Funds are authorized and captured (with manual capture, funds are held)
5. Upon contract completion, provider releases payment
6. Stripe transfers funds to tasker's connected account (minus Stripe fees)
7. Platform receives its fee

### Interac e-Transfer
1. Provider selects Interac payment method
2. Provider enters their email for notification
3. System generates payment instructions
4. Provider sends Interac e-Transfer through their online banking
5. Tasker receives email notification and deposits funds
6. System marks payment as complete
7. Platform receives its fee (would need to be handled separately)

## Withdrawal Process

### Stripe
1. Taskers can withdraw funds directly to their bank account
2. Standard payout schedule (2-day rolling basis)
3. Instant payouts available for a fee

### Interac
1. For Interac payments, funds are already in the tasker's bank account
2. No separate withdrawal process needed
3. Tasker would need to transfer funds to a separate business account if desired

## Considerations for Implementation

### Instant vs. Asynchronous Payments
- **Stripe**: Instant processing, immediate fund availability (in escrow)
- **Interac**: Asynchronous processing, takes minutes to hours for recipient to deposit

### Refunds
- **Stripe**: Automated refund process through API
- **Interac**: Manual process, depends on whether recipient has deposited funds

### Compliance
- Both methods require compliance with Canadian financial regulations
- Interac requires registration with Interac Corp
- Stripe requires PCI compliance for card processing

### User Experience
- Stripe provides a seamless, integrated experience
- Interac requires users to leave the platform to complete payment through online banking

## Recommendations

1. **Use Stripe for**:
   - Users who want instant payments
   - International transactions
   - Better integration with the platform

2. **Use Interac for**:
   - Cost-conscious Canadian users
   - Users who prefer bank-to-bank transfers
   - Transactions where immediacy isn't critical

3. **Fee Optimization**:
   - For smaller transactions, Interac might be more cost-effective
   - For larger transactions, the percentage difference becomes more significant

4. **Tax Handling**:
   - Ensure proper tax calculation and reporting for both methods
   - Consider province-specific HST rates
   - Maintain detailed records for tax filings