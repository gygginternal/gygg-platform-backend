import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

// Test JWT token validation
const testToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY3NzY5YzY5ZjE5YzE4ZjE5YzE4ZjE5YyIsInJvbGUiOlsidGFza2VyIl0sImlhdCI6MTczNTY3NjAwMCwiZXhwIjoxNzQzNDUyMDAwfQ.example'; // Replace with actual token from localStorage

console.log('JWT_SECRET:', process.env.JWT_SECRET ? 'Present' : 'Missing');

try {
  const decoded = jwt.verify(testToken, process.env.JWT_SECRET);
  console.log('Token is valid:', decoded);
} catch (error) {
  console.log('Token validation failed:', error.message);
}