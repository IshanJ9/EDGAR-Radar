/**
 * Runs before every test file (see jest.config.js's `setupFiles`, reused by
 * jest.integration.config.js too).
 *
 * Deliberately does NOT load the real `.env` (no `dotenv/config` here).
 * `src/sec.ts` throws at import time if `EDGAR_CONTACT_EMAIL` is unset (via
 * `requireEnv`, src/config.ts), and both scoring.ts and filingText.ts import
 * it transitively - so without something setting this, `npm test` would only
 * work on a machine that already has a real, populated `.env`, which defeats
 * the point of a unit test. This value is a placeholder for module-load
 * safety only: these unit tests mock every network/DB boundary (see
 * scoring.test.ts) and never make a real SEC call, so it never needs to be a
 * real, working address.
 */
process.env.EDGAR_CONTACT_EMAIL ??= 'test-placeholder@example.com';

/**
 * The same problem for DATABASE_URL, which src/db.ts has validated at import
 * since Phase 6's failure case 2 (src/config.ts). scoring.test.ts calls
 * `jest.mock('../repositories/scoringRepository')` with no factory, and to
 * generate that automock Jest loads the real module - which imports db.ts.
 * Without this line `npm test` failed with "DATABASE_URL is not set" before a
 * single test ran; that was observed, not predicted.
 *
 * The placeholder never connects anywhere: `pg` only opens a connection on
 * the first query, no unit test issues one, and the `.invalid` top-level
 * domain is reserved so it can never resolve even if something did try.
 * `??=` leaves the real URL that scripts/runIntegrationTests.ts passes to the
 * integration suite untouched.
 */
process.env.DATABASE_URL ??= 'postgresql://placeholder:placeholder@unit-tests-never-connect.invalid:5432/placeholder';

/**
 * Phase 6, step 5: structurally enforces ROADMAP.md's "remove any test that
 * hits real SEC" - not as a rule someone has to remember, but as something
 * that makes a real network call fail loudly. `nock`'s per-test interceptors
 * (see sec.contract.test.ts) are unaffected by this - they still intercept
 * their matching requests exactly as defined; this only blocks any request
 * that falls through with no interceptor defined for it, which would
 * otherwise silently succeed as a genuine call to the real internet.
 *
 * Safe for the integration suite (jest.integration.config.js) too: nock
 * patches Node's HTTP client machinery only. It has no effect on `pg`'s raw
 * TCP wire protocol to the throwaway Postgres container, so this cannot
 * block those tests' real database connection.
 */
import nock from 'nock';
nock.disableNetConnect();
