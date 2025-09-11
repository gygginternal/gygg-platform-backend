import fs from 'fs';
import path from 'path';

// Import the function using require to avoid module issues
const { generateInvoicePdf } = await import('./src/utils/invoicePdf_with_logo.js');

// Create a writable stream for the PDF
const outputPath = path.resolve('test-invoice.pdf');
const writeStream = fs.createWriteStream(outputPath);

// Create a mock response object that behaves like an HTTP response
const mockRes = {
  setHeader: (key, value) => {
    console.log(`Setting header: ${key} = ${value}`);
  },
  status: function(code) {
    this.statusCode = code;
    return this;
  },
  json: function(data) {
    console.log('JSON Response:', data);
  },
  // Stream methods that pdfkit expects
  on: function(event, callback) {
    // For our test, we don't need to do anything here
    return this;
  },
  once: function(event, callback) {
    // For our test, we don't need to do anything here
    return this;
  },
  removeListener: function(event, callback) {
    // For our test, we don't need to do anything here
    return this;
  },
  emit: function(event, data) {
    // For our test, we don't need to do anything here
    return false;
  },
  write: function(chunk, encoding, callback) {
    // Delegate to our write stream
    return writeStream.write(chunk, encoding, callback);
  },
  end: function(chunk, encoding, callback) {
    // Delegate to our write stream
    return writeStream.end(chunk, encoding, callback);
  }
};

// Override the pipe method to work with our test
mockRes.pipe = function(destination) {
  // In a real HTTP response, this would pipe to the response
  // For testing, we'll delegate to our file write stream
  return this;
};

// Test data
const testData = {
  paymentId: 'test123',
  date: '2023-05-15',
  gigTitle: 'Website Development',
  contractId: 'contract456',
  providerFirstName: 'John',
  providerLastName: 'Doe',
  providerEmail: 'john@example.com',
  taskerFirstName: 'Jane',
  taskerLastName: 'Smith',
  taskerEmail: 'jane@example.com',
  amount: '500.00',
  currency: 'CAD',
  platformFee: '50.00',
  tax: '65.00',
  providerTax: '65.00',
  taskerTax: '0.00',
  totalProviderPayment: '615.00',
  payout: '500.00'
};

console.log('Testing invoice generation with logo...');

// Listen for the finish event
writeStream.on('finish', () => {
  console.log('PDF generated successfully at:', outputPath);
});

// Listen for errors
writeStream.on('error', (err) => {
  console.error('Error writing PDF:', err);
});

try {
  generateInvoicePdf(testData, mockRes, 'tasker');
  console.log('\nTest initiated. Check the generated PDF file.');
} catch (error) {
  console.error('Error generating PDF:', error);
}