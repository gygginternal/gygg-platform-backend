import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';

// Function to get the logo path
function getLogoPath() {
  const logoPath = path.resolve('src/utils/assets/gygg-logo.png');
  if (fs.existsSync(logoPath)) {
    return logoPath;
  }
  // Try alternative path for test environments
  const altLogoPath = path.resolve('backend/src/utils/assets/gygg-logo.png');
  if (fs.existsSync(altLogoPath)) {
    return altLogoPath;
  }
  return null;
}

// Main function to generate and stream PDF with improved styling and logo
export function generateInvoicePdf(invoiceData, res, userRole = 'tasker') {
  try {
    const doc = new PDFDocument({ margin: 50 });
    
    // Register Inter fonts
    const fontPath = path.resolve('src/utils/assets/fonts/');
    doc.registerFont('Inter', path.join(fontPath, 'Inter-Regular.ttf'));
    doc.registerFont('Inter-Bold', path.join(fontPath, 'Inter-Bold.ttf'));
    
    // Set default font
    doc.font('Inter');
    
    // Set headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=invoice-${invoiceData.paymentId}.pdf`);
    
    // Pipe the PDF to response
    doc.pipe(res);
    
    // Add logo if available
    const logoPath = getLogoPath();
    let yPosition = 50;
    
    if (logoPath) {
      try {
        // Add logo at the top
        doc.image(logoPath, 50, 30, { width: 50, height: 50 });
        
        // Header with platform name next to logo
        doc.fontSize(24)
           .font('Inter-Bold')
           .fillColor('#D99633')
           .text('GYGG PLATFORM', 110, 45);
        
        doc.fontSize(16)
           .font('Inter')
           .fillColor('black')
           .text('Professional Services Invoice', 110, 75);
        
        yPosition = 120;
      } catch (logoError) {
        console.error('Error loading logo:', logoError);
        // Fallback to text-only header
        doc.fontSize(24)
           .font('Inter-Bold')
           .fillColor('#D99633')
           .text('GYGG PLATFORM', 50, 50, { align: 'center' });
        
        doc.fontSize(16)
           .font('Inter')
           .fillColor('black')
           .text('Professional Services Invoice', 50, 80, { align: 'center' });
        
        yPosition = 140;
      }
    } else {
      // Fallback to text-only header if no logo
      doc.fontSize(24)
         .font('Inter-Bold')
         .fillColor('#D99633')
         .text('GYGG PLATFORM', 50, 50, { align: 'center' });
      
      doc.fontSize(16)
         .font('Inter')
         .fillColor('black')
         .text('Professional Services Invoice', 50, 80, { align: 'center' });
      
      yPosition = 140;
    }
    
    // Add a line separator
    doc.moveTo(50, yPosition)
       .lineTo(550, yPosition)
       .lineWidth(2)
       .stroke();
    
    // Invoice details section
    yPosition += 30;
    doc.fontSize(14)
       .text('INVOICE DETAILS', 50, yPosition, { underline: true });
    
    yPosition += 25;
    doc.fontSize(11)
       .text(`Invoice Number: INV-${invoiceData.paymentId}`, 50, yPosition)
       .text(`Date Issued: ${invoiceData.date}`, 300, yPosition)
       .text('Payment Status: Completed', 50, yPosition + 15)
       .text('Payment Method: Credit Card (Stripe)', 300, yPosition + 15);
    
    // Service provider section
    yPosition += 60;
    doc.fontSize(14)
       .text('SERVICE PROVIDER', 50, yPosition, { underline: true });
    
    yPosition += 25;
    doc.fontSize(11)
       .text(`Name: ${invoiceData.taskerFirstName} ${invoiceData.taskerLastName}`, 50, yPosition)
       .text(`Email: ${invoiceData.taskerEmail}`, 50, yPosition + 15);
    
    // Client section
    yPosition += 50;
    doc.fontSize(14)
       .text('CLIENT INFORMATION', 50, yPosition, { underline: true });
    
    yPosition += 25;
    doc.fontSize(11)
       .text(`Name: ${invoiceData.providerFirstName} ${invoiceData.providerLastName}`, 50, yPosition)
       .text(`Email: ${invoiceData.providerEmail}`, 50, yPosition + 15);
    
    // Service details
    yPosition += 50;
    doc.fontSize(14)
       .text('SERVICE DETAILS', 50, yPosition, { underline: true });
    
    yPosition += 25;
    doc.fontSize(11)
       .text(`Service: ${invoiceData.gigTitle}`, 50, yPosition)
       .text(`Contract ID: ${invoiceData.contractId}`, 50, yPosition + 15);
    
    // Payment breakdown - IMPROVED VERSION
    yPosition += 60;
    doc.fontSize(14)
       .text('PAYMENT BREAKDOWN', 50, yPosition, { underline: true });
    
    yPosition += 25;
    if (userRole === 'provider') {
      // Provider invoice shows what they pay
      doc.fontSize(11)
         .text(`Service Amount (to tasker):`, 50, yPosition)
         .text(`${invoiceData.amount}`, 400, yPosition, { align: 'right' })
         .text(`Platform Fee (to platform):`, 50, yPosition + 15)
         .text(`${invoiceData.platformFee}`, 400, yPosition + 15, { align: 'right' })
         .text(`Tax (HST/GST):`, 50, yPosition + 30)
         .text(`$${invoiceData.providerTax || invoiceData.tax}`, 400, yPosition + 30, { align: 'right' });
    } else {
      // Tasker invoice shows what they receive (full amount, no deductions)
      doc.fontSize(11)
         .text(`Service Amount Received:`, 50, yPosition)
         .text(`${invoiceData.amount}`, 400, yPosition, { align: 'right' })
         .text(`Platform Fee (paid by provider):`, 50, yPosition + 15)
         .text(`${invoiceData.platformFee}`, 400, yPosition + 15, { align: 'right' })
         .text(`Tax (paid by provider):`, 50, yPosition + 30)
         .text(`${invoiceData.providerTax || invoiceData.tax}`, 400, yPosition + 30, { align: 'right' });
      
      // Add note for tasker
      yPosition += 60;
      doc.fontSize(10)
         .text('✓ You receive the full service amount with no deductions!', 50, yPosition)
         .text('Platform fees and taxes are paid separately by the client.', 50, yPosition + 15);
    }
    
    // Add line for total
    yPosition += 50;
    doc.moveTo(50, yPosition)
       .lineTo(550, yPosition)
       .lineWidth(1)
       .stroke();
    
    // Net amount - different for provider vs tasker
    yPosition += 15;
    if (userRole === 'provider') {
      doc.fontSize(12)
         .text('TOTAL AMOUNT PAID:', 50, yPosition)
         .text(`${invoiceData.totalProviderPayment || invoiceData.amount}`, 400, yPosition, { align: 'right' });
      
      // Add note for provider
      yPosition += 30;
      doc.fontSize(10)
         .text('This amount includes the service fee, platform fee, and applicable taxes.', 50, yPosition);
    } else {
      doc.fontSize(12)
         .text('NET AMOUNT RECEIVED:', 50, yPosition)
         .text(`${invoiceData.payout}`, 400, yPosition, { align: 'right' });
    }
    
    // Footer
    yPosition += 80;
    doc.fontSize(10)
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