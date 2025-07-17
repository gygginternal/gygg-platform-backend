// Mock for invoicePdf.js
export function generateInvoicePdf(invoiceData, res) {
  // Mock implementation
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': ttachment; filename=invoice-.pdf,
    'Content-Length': 1000,
  });
  res.end(Buffer.from('Mock PDF content for testing'));
}
