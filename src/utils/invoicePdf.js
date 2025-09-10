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
export function generateInvoicePdf(invoiceData, res, userRole = 'tasker') {
  try {
    const doc = new PDFDocument({ margin: 50 });
    
    // Set headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=invoice-${invoiceData.paymentId}.pdf`);
    
    // Pipe the PDF to response
    doc.pipe(res);
    
    // Header with logo area and title
    doc.fontSize(24)
       .fillColor('#000000')
       .text('GYGG PLATFORM', 50, 50, { align: 'center' });
    
    doc.fontSize(16)
       .fillColor('#000000')
       .text('Professional Services Invoice', 50, 80, { align: 'center' });
    
    // Add a line separator
    doc.moveTo(50, 110)
       .lineTo(550, 110)
       .strokeColor('#000000')
       .lineWidth(2)
       .stroke();
    
    // Invoice details section
    let yPosition = 140;
    doc.fontSize(14)
       .fillColor('#000000')
       .text('INVOICE DETAILS', 50, yPosition, { underline: true });
    
    yPosition += 25;
    doc.fontSize(11)
       .fillColor('#000000')
       .text(`Invoice Number: INV-${invoiceData.paymentId}`, 50, yPosition)
       .text(`Date Issued: ${invoiceData.date}`, 300, yPosition)
       .text('Payment Status: Completed', 50, yPosition + 15)
       .text('Payment Method: Credit Card (Stripe)', 300, yPosition + 15);
    
    // Service provider section
    yPosition += 60;
    doc.fontSize(14)
       .fillColor('#000000')
       .text('SERVICE PROVIDER', 50, yPosition, { underline: true });
    
    yPosition += 25;
    doc.fontSize(11)
       .fillColor('#000000')
       .text(`Name: ${invoiceData.taskerFirstName} ${invoiceData.taskerLastName}`, 50, yPosition)
       .text(`Email: ${invoiceData.taskerEmail}`, 50, yPosition + 15);
    
    // Client section
    yPosition += 50;
    doc.fontSize(14)
       .fillColor('#000000')
       .text('CLIENT INFORMATION', 50, yPosition, { underline: true });
    
    yPosition += 25;
    doc.fontSize(11)
       .fillColor('#000000')
       .text(`Name: ${invoiceData.providerFirstName} ${invoiceData.providerLastName}`, 50, yPosition)
       .text(`Email: ${invoiceData.providerEmail}`, 50, yPosition + 15);
    
    // Service details
    yPosition += 50;
    doc.fontSize(14)
       .fillColor('#000000')
       .text('SERVICE DETAILS', 50, yPosition, { underline: true });
    
    yPosition += 25;
    doc.fontSize(11)
       .fillColor('#000000')
       .text(`Service: ${invoiceData.gigTitle}`, 50, yPosition)
       .text(`Contract ID: ${invoiceData.contractId}`, 50, yPosition + 15);
    
    // Payment breakdown
    yPosition += 60;
    doc.fontSize(14)
       .fillColor('#000000')
       .text('PAYMENT BREAKDOWN', 50, yPosition, { underline: true });
    
    yPosition += 25;
    if (userRole === 'provider') {
      // Provider invoice shows what they pay
      doc.fontSize(11)
         .fillColor('#000000')
         .text(`Service Amount:`, 50, yPosition)
         .text(`${invoiceData.amount} ${invoiceData.currency.toUpperCase()}`, 400, yPosition, { align: 'right' })
         .text(`Platform Fee (10% + $5.00):`, 50, yPosition + 15)
         .text(`${invoiceData.platformFee} ${invoiceData.currency.toUpperCase()}`, 400, yPosition + 15, { align: 'right' })
         .text(`Provider Tax:`, 50, yPosition + 30)
         .text(`${invoiceData.providerTax || invoiceData.tax} ${invoiceData.currency.toUpperCase()}`, 400, yPosition + 30, { align: 'right' });
    } else {
      // Tasker invoice shows only what they receive (no fees or tax details)
      doc.fontSize(11)
         .fillColor('#000000')
         .text(`Service Amount:`, 50, yPosition)
         .text(`${invoiceData.amount} ${invoiceData.currency.toUpperCase()}`, 400, yPosition, { align: 'right' });
    }
    
    // Add line for total
    yPosition += 50;
    doc.moveTo(50, yPosition)
       .lineTo(550, yPosition)
       .strokeColor('#000000')
       .lineWidth(1)
       .stroke();
    
    // Net amount - different for provider vs tasker
    yPosition += 15;
    if (userRole === 'provider') {
      doc.fontSize(12)
         .fillColor('#000000')
         .text('TOTAL AMOUNT PAID:', 50, yPosition, { continued: true })
         .fillColor('#000000')
         .text(`${invoiceData.totalProviderPayment || invoiceData.amount} ${invoiceData.currency.toUpperCase()}`, 400, yPosition, { align: 'right' });
    } else {
      doc.fontSize(12)
         .fillColor('#000000')
         .text('AMOUNT RECEIVED:', 50, yPosition, { continued: true })
         .fillColor('#000000')
         .text(`${invoiceData.payout} ${invoiceData.currency.toUpperCase()}`, 400, yPosition, { align: 'right' });
    }
    
    // Footer
    yPosition += 80;
    doc.fontSize(10)
       .fillColor('#000000')
       .text('Thank you for using Gygg Platform!', 50, yPosition, { align: 'center' })
       .text('For support: support@gygg.com | www.gygg.com', 50, yPosition + 15, { align: 'center' })
       .text(`Generated on ${invoiceData.date} | Document ID: ${invoiceData.paymentId}`, 50, yPosition + 40, { align: 'center' });
    
    // Finalize the PDF
    doc.end();
    
  } catch (err) {
    console.error('PDF generation error:', err);
    if (!res.headersSent) {
      res.status(500).json({ 
        status: 'error', 
        message: 'Failed to generate invoice PDF', 
        error: err.message 
      });
    }
  }
}
