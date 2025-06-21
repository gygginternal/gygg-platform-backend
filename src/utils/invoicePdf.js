import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';

// Helper to fill template placeholders
function fillTemplate(template, data) {
  return template.replace(/\{\{(.*?)\}\}/g, (_, key) => data[key.trim()] ?? '');
}

// Main function to generate and stream PDF
export function generateInvoicePdf(invoiceData, res) {
  const templatePath = path.join(__dirname, 'invoiceTemplate.txt');
  const template = fs.readFileSync(templatePath, 'utf-8');
  const filledText = fillTemplate(template, invoiceData);

  const doc = new PDFDocument({ margin: 50 });
  let buffers = [];
  doc.on('data', buffers.push.bind(buffers));
  doc.on('end', () => {
    const pdfData = Buffer.concat(buffers);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename=invoice-${invoiceData.paymentId}.pdf`,
      'Content-Length': pdfData.length,
    });
    res.end(pdfData);
  });

  // Write the filled text to the PDF (monospaced for alignment)
  doc.font('Courier').fontSize(11).text(filledText, { lineGap: 2 });
  doc.end();
} 