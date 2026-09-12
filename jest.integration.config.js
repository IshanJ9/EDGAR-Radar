/**
 * Phase 6, step 4 (integration tests). Only ever invoked via
 * `npm run test:integration` (scripts/runIntegrationTests.ts), which starts
 * a real, throwaway Postgres first and points DATABASE_URL at it - running
 * this config directly against no database will fail every test.
 */
/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.integration.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  setupFiles: ['<rootDir>/jest.setup.ts'],
  testTimeout: 30000,
  // Integration suites share one real Postgres instance and truncate
  // tables between test cases for isolation (see each file's beforeEach) -
  // running files in parallel would let two suites race on the same
  // tables, so this forces one file at a time.
  maxWorkers: 1,
};
