import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';

// Robust template path resolution for test and production
function resolveTemplatePath() {
  const candidates = [
    path.resolve('src/utils/invoiceTemplate.txt'),
    path.resolve('backend/src/utils/invoiceTemplate.txt'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('invoiceTemplate.txt not found in expected locations');
}
const templatePath = resolveTemplatePath();

// Helper to fill template placeholders
function fillTemplate(template, data) {
  return template.replace(/\{\{(.*?)\}\}/g, (_, key) => data[key.trim()] ?? '');
}

// Main function to generate and stream PDF
export function generateInvoicePdf(invoiceData, res) {
  try {
    // Read the template file
    const template = fs.readFileSync(templatePath, 'utf-8');
    const filledTemplate = fillTemplate(template, invoiceData);

    const doc = new PDFDocument();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=invoice.pdf');
    doc.pipe(res);
    doc.text(filledTemplate);
    doc.end();
  } catch (err) {
    res.status(500).json({ status: 'error', message: 'Failed to generate invoice PDF', error: err.message });
  }
}
