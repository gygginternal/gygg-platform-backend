const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

// Main function to generate and stream PDF with improved fee structure
function generateInvoicePdf(invoiceData, res, userRole = 'tasker') {
  try {
    const doc = new PDFDocument({ margin: 50 });
    
    // Set headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=invoice-${invoiceData.paymentId}.pdf`);
    
    // Pipe the PDF to response
    doc.pipe(res);
    
    // Header with logo area and title
    doc.fontSize(24)
       .fillColor('#2563eb')
       .text('GYGG PLATFORM', 50, 50, { align: 'center' });
    
    doc.fontSize(16)
       .fillColor('#666')
       .text('Professional Services Invoice', 50, 80, { align: 'center' });
    
    // Add a line separator
    doc.moveTo(50, 110)
       .lineTo(550, 110)
       .strokeColor('#2563eb')
       .lineWidth(2)
       .stroke();
    
    // Invoice details section
    let yPosition = 140;
    doc.fontSize(14)
       .fillColor('#333')
       .text('INVOICE DETAILS', 50, yPosition, { underline: true });
    
    yPosition += 25;
    doc.fontSize(11)
       .fillColor('#666')
       .text(`Invoice Number: INV-${invoiceData.paymentId}`, 50, yPosition)
       .text(`Date Issued: ${invoiceData.date}`, 300, yPosition)
       .text('Payment Status: Completed', 50, yPosition + 15)
       .text('Payment Method: Credit Card (Stripe)', 300, yPosition + 15);
    
    // Service provider section
    yPosition += 60;
    doc.fontSize(14)
       .fillColor('#333')
       .text('SERVICE PROVIDER', 50, yPosition, { underline: true });
    
    yPosition += 25;
    doc.fontSize(11)
       .fillColor('#666')
       .text(`Name: ${invoiceData.taskerFirstName} ${invoiceData.taskerLastName}`, 50, yPosition)
       .text(`Email: ${invoiceData.taskerEmail}`, 50, yPosition + 15);
    
    // Client section
    yPosition += 50;
    doc.fontSize(14)
       .fillColor('#333')
       .text('CLIENT INFORMATION', 50, yPosition, { underline: true });
    
    yPosition += 25;
    doc.fontSize(11)
       .fillColor('#666')
       .text(`Name: ${invoiceData.providerFirstName} ${invoiceData.providerLastName}`, 50, yPosition)
       .text(`Email: ${invoiceData.providerEmail}`, 50, yPosition + 15);
    
    // Service details
    yPosition += 50;
    doc.fontSize(14)
       .fillColor('#333')
       .text('SERVICE DETAILS', 50, yPosition, { underline: true });
    
    yPosition += 25;
    doc.fontSize(11)
       .fillColor('#666')
       .text(`Service: ${invoiceData.gigTitle}`, 50, yPosition)
       .text(`Contract ID: ${invoiceData.contractId}`, 50, yPosition + 15);
    
    // Payment breakdown - IMPROVED VERSION
    yPosition += 60;
    doc.fontSize(14)
       .fillColor('#333')
       .text('PAYMENT BREAKDOWN', 50, yPosition, { underline: true });
    
    yPosition += 25;
    if (userRole === 'provider') {
      // Provider invoice shows what they pay
      doc.fontSize(11)
         .fillColor('#666')
         .text(`Service Amount (to tasker):`, 50, yPosition)
         .text(`$${invoiceData.amount}`, 400, yPosition, { align: 'right' })
         .text(`Platform Fee (to platform):`, 50, yPosition + 15)
         .fillColor('#e67e22')
         .text(`$${invoiceData.platformFee}`, 400, yPosition + 15, { align: 'right' })
         .fillColor('#666')
         .text(`Tax (HST/GST):`, 50, yPosition + 30)
         .text(`$${invoiceData.providerTax || invoiceData.tax}`, 400, yPosition + 30, { align: 'right' });
    } else {
      // Tasker invoice shows what they receive (full amount, no deductions)
      doc.fontSize(11)
         .fillColor('#666')
         .text(`Service Amount Received:`, 50, yPosition)
         .fillColor('#27ae60')
         .text(`$${invoiceData.amount}`, 400, yPosition, { align: 'right' })
         .fillColor('#999')
         .text(`Platform Fee (paid by provider):`, 50, yPosition + 15)
         .text(`$${invoiceData.platformFee}`, 400, yPosition + 15, { align: 'right' })
         .text(`Tax (paid by provider):`, 50, yPosition + 30)
         .text(`$${invoiceData.providerTax || invoiceData.tax}`, 400, yPosition + 30, { align: 'right' });
      
      // Add note for tasker
      yPosition += 60;
      doc.fontSize(10)
         .fillColor('#27ae60')
         .text('✓ You receive the full service amount with no deductions!', 50, yPosition)
         .fillColor('#666')
         .text('Platform fees and taxes are paid separately by the client.', 50, yPosition + 15);
    }
    
    // Add line for total
    yPosition += 50;
    doc.moveTo(50, yPosition)
       .lineTo(550, yPosition)
       .strokeColor('#ccc')
       .lineWidth(1)
       .stroke();
    
    // Net amount - different for provider vs tasker
    yPosition += 15;
    if (userRole === 'provider') {
      doc.fontSize(12)
         .fillColor('#2563eb')
         .text('TOTAL AMOUNT PAID:', 50, yPosition)
         .fillColor('#e53935')
         .text(`$${invoiceData.totalProviderPayment || invoiceData.amount}`, 400, yPosition, { align: 'right' });
      
      // Add note for provider
      yPosition += 30;
      doc.fontSize(10)
         .fillColor('#666')
         .text('This amount includes the service fee, platform fee, and applicable taxes.', 50, yPosition);
    } else {
      doc.fontSize(12)
         .fillColor('#2563eb')
         .text('NET AMOUNT RECEIVED:', 50, yPosition)
         .fillColor('#27ae60')
         .text(`$${invoiceData.payout}`, 400, yPosition, { align: 'right' });
    }
    
    // Footer
    yPosition += 80;
    doc.fontSize(10)
       .fillColor('#666')
       .text('Thank you for using Gygg Platform!', 50, yPosition, { align: 'center' })
       .text('Platform fees support our service and help us maintain a secure marketplace.', 50, yPosition + 15, { align: 'center' })
       .text('For support: support@gygg.com | www.gygg.com', 50, yPosition + 30, { align: 'center' })
       .text(`Generated on ${invoiceData.date} | Document ID: ${invoiceData.paymentId}`, 50, yPosition + 50, { align: 'center' });
    
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

module.exports = { generateInvoicePdf };