// Mock implementation of invoicePdf.js
export function generateInvoicePdf(invoiceData, res) {
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': ttachment; filename=invoice-.pdf,
    'Content-Length': 1000,
  });
  res.end(Buffer.from('Mock PDF content'));
  return Promise.resolve();
}
