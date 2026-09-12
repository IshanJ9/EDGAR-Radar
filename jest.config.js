/**
 * Phase 6, step 3 (unit tests). ts-jest transforms each test file using this
 * project's own tsconfig.json - separately from `tsc`/`npm run build`, so
 * excluding test files from that project-wide compile (see tsconfig.json)
 * has no effect on Jest actually running and type-checking them here.
 *
 * Explicitly excludes *.integration.test.ts (Phase 6, step 4 -
 * jest.integration.config.js) - without that, this config's own
 * `**\/*.test.ts` testMatch would also match integration test filenames
 * (they end in .test.ts too) and `npm test` would try to run DB-touching
 * tests with no database available, failing every one of them.
 */
/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '\\.integration\\.test\\.ts$'],
  setupFiles: ['<rootDir>/jest.setup.ts'],
};
