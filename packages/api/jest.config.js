/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['**/tests/**/*.test.ts'],
  // Both refuse to run unless the target is a confirmed local *_test database
  // (docs/TESTING.md). globalSetup also asks the server for current_database().
  globalSetup: '<rootDir>/tests/global-setup.ts',
  setupFiles: ['<rootDir>/tests/setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },

  globals: {
    'ts-jest': {
      tsconfig: {
        strict: true,
        esModuleInterop: true,
      },
    },
  },
  testTimeout: 30000,
  // Run test files sequentially — all tests share one DB; parallel clearDatabase() calls corrupt each other
  maxWorkers: 1,
};
