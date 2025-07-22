// Test script to verify AWS Rekognition setup
import { RekognitionClient, DetectModerationLabelsCommand } from '@aws-sdk/client-rekognition';
import dotenv from 'dotenv';

dotenv.config();

const testRekognition = async () => {
  console.log('🔍 Testing AWS Rekognition Setup...\n');

  // Check environment variables
  const requiredEnvVars = [
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY', 
    'AWS_REGION',
    'AWS_S3_BUCKET_NAME'
  ];

  console.log('📋 Checking Environment Variables:');
  for (const envVar of requiredEnvVars) {
    const value = process.env[envVar];
    console.log(`  ${envVar}: ${value ? '✅ Set' : '❌ Missing'}`);
  }

  if (!requiredEnvVars.every(envVar => process.env[envVar])) {
    console.log('\n❌ Missing required environment variables. Please check your .env file.');
    return;
  }

  // Initialize Rekognition client
  const rekognitionClient = new RekognitionClient({
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });

  console.log('\n🔧 Rekognition Client Configuration:');
  console.log(`  Region: ${process.env.AWS_REGION}`);
  console.log(`  Bucket: ${process.env.AWS_S3_BUCKET_NAME}`);

  // Test with a sample image (you'll need to upload a test image to your S3 bucket)
  const testImageKey = 'test-image.jpg'; // Replace with actual test image in your bucket
  
  try {
    console.log('\n🧪 Testing Rekognition API...');
    
    const command = new DetectModerationLabelsCommand({
      Image: {
        S3Object: {
          Bucket: process.env.AWS_S3_BUCKET_NAME,
          Name: testImageKey,
        },
      },
      MinConfidence: 60,
    });

    const response = await rekognitionClient.send(command);
    
    console.log('✅ Rekognition API Test Successful!');
    console.log(`  Moderation Labels Found: ${response.ModerationLabels.length}`);
    
    if (response.ModerationLabels.length > 0) {
      console.log('  Labels:');
      response.ModerationLabels.forEach(label => {
        console.log(`    - ${label.Name} (${label.Confidence.toFixed(2)}% confidence)`);
      });
    } else {
      console.log('  ✅ Image appears to be appropriate (no moderation labels)');
    }

  } catch (error) {
    console.log('❌ Rekognition API Test Failed:');
    
    if (error.name === 'InvalidS3ObjectException') {
      console.log(`  Error: Test image '${testImageKey}' not found in bucket`);
      console.log(`  Solution: Upload a test image to your S3 bucket or update testImageKey`);
    } else if (error.name === 'AccessDeniedException') {
      console.log('  Error: Access denied - check IAM permissions');
      console.log('  Solution: Add Rekognition permissions to your IAM user/role');
    } else if (error.name === 'InvalidParameterException') {
      console.log('  Error: Invalid parameters - check bucket name and region');
    } else {
      console.log(`  Error: ${error.name} - ${error.message}`);
    }
  }

  console.log('\n📊 Cost Estimate:');
  console.log('  DetectModerationLabels: ~$0.001 per image');
  console.log('  Free Tier: 5,000 images/month for first 12 months');
  console.log('  Example: 1,000 images/month = ~$1.00');
};

// Run the test
testRekognition().catch(console.error);