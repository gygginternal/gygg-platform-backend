export default {
  transform: {
    '^.+\\.(js|jsx|mjs)$': 'babel-jest',
  },
  testEnvironment: 'node',
  moduleFileExtensions: ['js', 'json', 'node', 'mjs'],
  testMatch: ['**/tests/**/*.test.js', '**/__tests__/**/*.test.js'],
  modulePathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/build/'],
  testTimeout: 30000,
};