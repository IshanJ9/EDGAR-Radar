// @ts-check
const eslint = require('@eslint/js');
const tseslint = require('typescript-eslint');
const globals = require('globals');

/**
 * Phase 6, step 7. Deliberately scoped to `recommended`, not the stricter
 * `strict`/`stylistic` typescript-eslint presets - this is a large, already
 * working, already fully-tested codebase, and the goal here is catching
 * real bugs on every PR going forward, not a one-time mass style rewrite of
 * everything written before this step existed.
 */
module.exports = tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', '.cache/**', 'migrations/**'],
  },
  eslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  // typescript-eslint's rules scoped explicitly to `**/*.ts` - this config
  // file itself is plain CommonJS `.js`, and applying TS-specific rules
  // (like `no-require-imports`) to it would flag its own necessary
  // `require()` calls, which run before any TS transform exists at all.
  {
    files: ['**/*.ts'],
    extends: [...tseslint.configs.recommended],
    rules: {
      // A caught error is very often intentionally unused (e.g. a narrowed
      // `catch (err) { if (err instanceof SpecificError) ... }` block where
      // the fallthrough case doesn't need `err` itself) - this project does
      // that throughout its error-handling code, so only flag unused
      // *variables*, not unused catch-clause bindings.
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  {
    files: ['src/__tests__/**/*.ts', 'jest.setup.ts'],
    languageOptions: {
      globals: { ...globals.jest },
    },
  },
);
