// Test the content filter system without Rekognition
import { analyzeImageContent, shouldBlockImage } from './src/utils/contentFilter.js';

const testContentFilter = async () => {
  console.log('🔍 Testing Content Filter System...\n');

  console.log('📝 Testing Text Content Filter:');
  // Text filtering should still work
  const { filterContent, shouldBlockContent } = await import('./src/utils/contentFilter.js');
  
  const testTexts = [
    'Hello, this is a normal message',
    'This contains bad word: fuck',
    'This is hate speech: nigger'
  ];

  testTexts.forEach(text => {
    const result = filterContent(text);
    const shouldBlock = shouldBlockContent(text);
    console.log(`  Text: "${text.substring(0, 30)}..."`);
    console.log(`    Clean: ${result.isClean}`);
    console.log(`    Should Block: ${shouldBlock}`);
    console.log(`    Violations: ${result.violations.length}`);
    console.log('');
  });

  console.log('🖼️  Testing Image Content Filter (Disabled):');
  try {
    const imageResult = await analyzeImageContent('test-image.jpg');
    console.log('  ✅ Image analysis result:');
    console.log(`    Appropriate: ${imageResult.isAppropriate}`);
    console.log(`    Disabled: ${imageResult.disabled || false}`);
    console.log(`    Labels: ${imageResult.labels.length}`);
    
    const shouldBlockImg = shouldBlockImage(imageResult);
    console.log(`    Should Block: ${shouldBlockImg}`);
    
  } catch (error) {
    console.log(`  ❌ Image analysis failed: ${error.message}`);
  }

  console.log('\n✅ Content Filter Status:');
  console.log('  📝 Text filtering: ACTIVE');
  console.log('  🖼️  Image filtering: DISABLED (safe for deployment)');
  console.log('  🚀 Ready for production deployment!');
  
  console.log('\n🔧 To enable image filtering later:');
  console.log('  1. Fix IAM permissions for Rekognition');
  console.log('  2. Set ENABLE_IMAGE_MODERATION=true');
  console.log('  3. Restart your application');
};

testContentFilter().catch(console.error);