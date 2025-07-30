// Test script to resend verification email
import fetch from 'node-fetch';

const resendVerificationEmail = async (email) => {
  try {
    const response = await fetch('http://localhost:5000/api/v1/users/resendVerificationEmail', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email }),
    });

    const data = await response.json();
    
    console.log('Response Status:', response.status);
    console.log('Response Data:', data);
    
    if (response.ok) {
      console.log('✅ Verification email sent successfully!');
    } else {
      console.log('❌ Failed to send verification email');
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
};

// Test with the email that has expired token
const email = 'test@mail.com'; // Change this to the email you want to test
console.log(`🔄 Resending verification email to: ${email}`);
resendVerificationEmail(email);