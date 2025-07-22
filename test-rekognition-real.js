// Test Rekognition with real image from your S3 bucket
import { RekognitionClient, DetectModerationLabelsCommand } from '@aws-sdk/client-rekognition';
import dotenv from 'dotenv';

dotenv.config();

const testWithRealImage = async () => {
  console.log('🔍 Testing Rekognition with Real Image...\n');

  const rekognitionClient = new RekognitionClient({
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });

  // Use one of the images we found in your bucket
  const testImages = [
    'other-uploads/1750788898160-3cced93c81dc88fc06994ebed0f98946.jpeg',
    'other-uploads/1751765200122-2966f1217de9b6c328aea5094656b184.png',
    'other-uploads/1752250770381-920616dcd0e84b90fe7e8d4b306a01d0.png'
  ];

  for (const imageKey of testImages) {
    console.log(`🖼️  Testing image: ${imageKey}`);
    
    try {
      const command = new DetectModerationLabelsCommand({
        Image: {
          S3Object: {
            Bucket: process.env.AWS_S3_BUCKET_NAME,
            Name: imageKey,
          },
        },
        MinConfidence: 60,
      });

      const response = await rekognitionClient.send(command);
      
      console.log('  ✅ Analysis successful!');
      console.log(`  📊 Moderation labels found: ${response.ModerationLabels.length}`);
      
      if (response.ModerationLabels.length > 0) {
        console.log('  ⚠️  Moderation labels:');
        response.ModerationLabels.forEach(label => {
          console.log(`    - ${label.Name}: ${label.Confidence.toFixed(2)}% confidence`);
          if (label.ParentName) {
            console.log(`      (Category: ${label.ParentName})`);
          }
        });
      } else {
        console.log('  ✅ Image appears clean (no moderation issues detected)');
      }
      
      console.log(''); // Empty line for readability
      break; // Exit after first successful test
      
    } catch (error) {
      console.log(`  ❌ Failed: ${error.message}`);
      
      if (error.name === 'AccessDeniedException') {
        console.log('  💡 Solution: Update IAM policy with Rekognition permissions');
        console.log('  📄 Use the policy in: rekognition-iam-policy.json');
        break; // No point testing other images if permissions are wrong
      }
      
      console.log(''); // Try next image
    }
  }

  console.log('🎯 If successful, your image moderation is ready!');
  console.log('💰 Cost per analysis: ~$0.001 (very affordable)');
};

testWithRealImage().catch(console.error);