// Check what IAM permissions are actually available
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { IAMClient, ListAttachedUserPoliciesCommand, GetUserPolicyCommand, GetPolicyCommand, GetPolicyVersionCommand } from '@aws-sdk/client-iam';
import dotenv from 'dotenv';

dotenv.config();

const checkPermissions = async () => {
  console.log('🔍 Checking IAM Permissions...\n');

  // Get current user identity
  const stsClient = new STSClient({
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });

  try {
    const identity = await stsClient.send(new GetCallerIdentityCommand({}));
    console.log('👤 Current AWS Identity:');
    console.log(`  User ARN: ${identity.Arn}`);
    console.log(`  Account: ${identity.Account}`);
    console.log(`  User ID: ${identity.UserId}`);
    
    // Extract username from ARN
    const username = identity.Arn.split('/').pop();
    console.log(`  Username: ${username}\n`);

    // Check attached policies
    const iamClient = new IAMClient({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });

    console.log('📋 Checking Attached Policies:');
    try {
      const policies = await iamClient.send(new ListAttachedUserPoliciesCommand({
        UserName: username
      }));

      if (policies.AttachedPolicies.length === 0) {
        console.log('  ❌ No policies attached to user');
      } else {
        for (const policy of policies.AttachedPolicies) {
          console.log(`  📄 Policy: ${policy.PolicyName}`);
          console.log(`      ARN: ${policy.PolicyArn}`);
          
          // Check if this might be our Rekognition policy
          if (policy.PolicyName.toLowerCase().includes('rekognition')) {
            console.log('      ✅ This looks like a Rekognition policy!');
          }
        }
      }
    } catch (error) {
      console.log(`  ❌ Cannot list policies: ${error.message}`);
    }

  } catch (error) {
    console.log(`❌ Failed to get identity: ${error.message}`);
  }

  console.log('\n🔧 Troubleshooting Steps:');
  console.log('1. Make sure the policy is attached to the correct user');
  console.log('2. Verify the policy contains "rekognition:DetectModerationLabels"');
  console.log('3. Wait 2-3 minutes for AWS to propagate changes');
  console.log('4. Try the test again');
  
  console.log('\n📝 Quick Fix - Attach AWS Managed Policy:');
  console.log('   Policy ARN: arn:aws:iam::aws:policy/AmazonRekognitionReadOnlyAccess');
  console.log('   This gives basic Rekognition permissions quickly');
};

checkPermissions().catch(console.error);