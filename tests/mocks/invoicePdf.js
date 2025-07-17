// Mock for invoicePdf.js
export function generateInvoicePdf(invoiceData, res) {
  // Mock implementation
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename=invoice-${invoiceData.paymentId}.pdf`,
    'Content-Length': 0,
  });
  res.end(Buffer.from('Mock PDF'));
}