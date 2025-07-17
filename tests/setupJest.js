// Mock modules that use import.meta.url
jest.mock('../src/utils/invoicePdf.js', () => ({
  generateInvoicePdf: jest.fn((invoiceData, res) => {
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': ttachment; filename=invoice-.pdf,
      'Content-Length': 1000,
    });
    res.end(Buffer.from('Mock PDF content'));
    return Promise.resolve();
  })
}));
