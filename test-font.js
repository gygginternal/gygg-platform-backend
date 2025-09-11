import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';

// Create a simple test to check if we can use the Inter font
console.log('Testing Inter font with pdfkit...');

try {
  // Create a document
  const doc = new PDFDocument();
  
  // Register Inter fonts
  const fontPath = path.resolve('src/utils/assets/fonts/');
  console.log('Font path:', fontPath);
  
  // Check if font files exist
  const regularFont = path.join(fontPath, 'Inter-Regular.ttf');
  const boldFont = path.join(fontPath, 'Inter-Bold.ttf');
  
  console.log('Regular font exists:', fs.existsSync(regularFont));
  console.log('Bold font exists:', fs.existsSync(boldFont));
  
  if (fs.existsSync(regularFont) && fs.existsSync(boldFont)) {
    doc.registerFont('Inter', regularFont);
    doc.registerFont('Inter-Bold', boldFont);
    
    console.log('Fonts registered successfully');
    
    // Test using the fonts
    doc.font('Inter').fontSize(24).text('This is Inter Regular');
    doc.font('Inter-Bold').fontSize(24).text('This is Inter Bold');
    
    // Write to file
    const outputPath = path.resolve('font-test.pdf');
    doc.pipe(fs.createWriteStream(outputPath));
    doc.end();
    
    console.log('Font test PDF generated successfully at:', outputPath);
  } else {
    console.log('Font files not found');
  }
} catch (error) {
  console.error('Error testing fonts:', error);
}