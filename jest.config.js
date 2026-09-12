/**
 * Phase 6, step 3 (unit tests). ts-jest transforms each test file using this
 * project's own tsconfig.json - separately from `tsc`/`npm run build`, so
 * excluding test files from that project-wide compile (see tsconfig.json)
 * has no effect on Jest actually running and type-checking them here.
 */
/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  setupFiles: ['<rootDir>/jest.setup.ts'],
};
