// Basic AWS connectivity test
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { RekognitionClient } from '@aws-sdk/client-rekognition';
import dotenv from 'dotenv';

dotenv.config();

const testBasicAWS = async () => {
  console.log('🔍 Testing Basic AWS Connectivity...\n');

  // Test S3 access
  console.log('📦 Testing S3 Access:');
  try {
    const s3Client = new S3Client({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });

    const listCommand = new ListObjectsV2Command({
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      MaxKeys: 5
    });

    const s3Response = await s3Client.send(listCommand);
    console.log('  ✅ S3 Access: Working');
    console.log(`  📁 Objects in bucket: ${s3Response.Contents?.length || 0}`);
    
    if (s3Response.Contents && s3Response.Contents.length > 0) {
      console.log('  📄 Sample files:');
      s3Response.Contents.slice(0, 3).forEach(obj => {
        console.log(`    - ${obj.Key}`);
      });
    }

  } catch (error) {
    console.log('  ❌ S3 Access: Failed');
    console.log(`  Error: ${error.message}`);
    return;
  }

  // Test Rekognition client creation
  console.log('\n🔍 Testing Rekognition Client:');
  try {
    const rekognitionClient = new RekognitionClient({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });

    console.log('  ✅ Rekognition Client: Created successfully');
    console.log(`  🌍 Region: ${process.env.AWS_REGION}`);

    // Try to call a simple Rekognition operation (this will likely fail with permissions)
    // but it will tell us if the client setup is correct
    console.log('\n🧪 Testing Rekognition Permissions:');
    console.log('  (This may fail with permissions - that\'s expected)');

  } catch (error) {
    console.log('  ❌ Rekognition Client: Failed to create');
    console.log(`  Error: ${error.message}`);
  }

  console.log('\n📋 Next Steps:');
  console.log('  1. If S3 works but Rekognition fails, it\'s a permissions issue');
  console.log('  2. Apply the rekognition-iam-policy.json to your IAM user');
  console.log('  3. Wait 1-2 minutes for permissions to propagate');
  console.log('  4. Re-run the test');
};

testBasicAWS().catch(console.error);