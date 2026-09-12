/**
 * Runs before every test file (see jest.config.js's `setupFiles`).
 *
 * Deliberately does NOT load the real `.env` (no `dotenv/config` here).
 * `src/sec.ts` throws at import time if `EDGAR_CONTACT_EMAIL` is unset, and
 * both scoring.ts and filingText.ts import it transitively - so without
 * something setting this, `npm test` would only work on a machine that
 * already has a real, populated `.env`, which defeats the point of a unit
 * test. This value is a placeholder for module-load safety only: these
 * unit tests mock every network/DB boundary (see scoring.test.ts) and never
 * make a real SEC call, so it never needs to be a real, working address.
 */
process.env.EDGAR_CONTACT_EMAIL ??= 'test-placeholder@example.com';
