/**
 * Contract tests for the SEC client (src/sec.ts, src/retry.ts) - Phase 6,
 * step 5. Every real HTTP call SEC's API would receive is intercepted by
 * `nock`; nothing here ever reaches the real internet (enforced structurally
 * by `nock.disableNetConnect()` in jest.setup.ts, not just by convention -
 * a request with no matching interceptor throws instead of silently
 * succeeding for real).
 *
 * Verified before writing this file, not assumed: `nock` (v14) DOES
 * correctly intercept Node's built-in `fetch` (undici-based) - historically
 * a real compatibility gap in older nock versions, since nock primarily
 * patches the `http`/`https` modules that native `fetch` doesn't route
 * through the same way. Confirmed directly against this project's own
 * `secFetch` in a throwaway script before any test below was written.
 *
 * Retry/backoff tests call `fetchWithRetry` directly (not through
 * `secFetch`) with an injected no-op `sleep`, so they run instantly
 * regardless of `retry.ts`'s real exponential-backoff delays - `sec.ts`
 * doesn't expose a way to inject that into `secFetch` itself (and this step
 * doesn't add one, since that would be a production-code change beyond
 * "write tests"), so `secFetch`'s own retry *wiring* is proven separately,
 * accepting its one real (bounded, single-retry) backoff delay.
 */
import nock from 'nock';
import { fetchWithRetry } from '../retry';
import { fetchCompanyFacts, fetchSubmissions, secFetch, padCik, CompanyFactsNotFoundError, SubmissionsNotFoundError } from '../sec';

const SEC_HOST = 'https://data.sec.gov';
const CIK = '320193';
const PADDED_CIK = padCik(CIK);

afterEach(() => {
  nock.cleanAll();
});

describe('fetchCompanyFacts', () => {
  test('requests the correct URL and returns the parsed JSON body on success', async () => {
    const fixture = { cik: 320193, entityName: 'Apple Inc.', facts: { 'us-gaap': {} } };
    const scope = nock(SEC_HOST).get(`/api/xbrl/companyfacts/CIK${PADDED_CIK}.json`).reply(200, fixture);

    const result = await fetchCompanyFacts(CIK);

    expect(result).toEqual(fixture);
    expect(scope.isDone()).toBe(true);
  });

  test('sends a descriptive User-Agent header with a real contact email, per SEC’s own requirement', async () => {
    const scope = nock(SEC_HOST)
      .get(`/api/xbrl/companyfacts/CIK${PADDED_CIK}.json`)
      .matchHeader('User-Agent', /^EDGAR Radar \(.+@.+\)$/)
      .reply(200, {});

    await fetchCompanyFacts(CIK);

    expect(scope.isDone()).toBe(true);
  });

  test('throws CompanyFactsNotFoundError on a 404, not a generic error', async () => {
    // A single call, asserted on once: calling fetchCompanyFacts twice
    // against one nock interceptor left the second call with nothing to
    // match, which (with nock.disableNetConnect() active) threw a blocked-
    // network error that fetchWithRetry then retried for real, at its
    // default multi-second backoff delays - confirmed as the actual cause
    // of an unexpectedly slow first version of this test, not a guess.
    nock(SEC_HOST).get(`/api/xbrl/companyfacts/CIK${PADDED_CIK}.json`).reply(404);

    let caught: unknown;
    try {
      await fetchCompanyFacts(CIK);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CompanyFactsNotFoundError);
    expect((caught as Error).message).toContain(PADDED_CIK);
  });

  test('throws a generic Error (not CompanyFactsNotFoundError) on a persistent non-404 failure', async () => {
    // 403 is not retryable (retry.ts only retries 5xx) and not 404, so this
    // exercises the plain "Request to ... failed with status ..." path.
    nock(SEC_HOST).get(`/api/xbrl/companyfacts/CIK${PADDED_CIK}.json`).reply(403);

    let caught: unknown;
    try {
      await fetchCompanyFacts(CIK);
    } catch (error) {
      caught = error;
    }
    expect((caught as Error).message).toContain('failed with status 403');
    expect(caught).not.toBeInstanceOf(CompanyFactsNotFoundError);
  });
});

describe('fetchSubmissions', () => {
  test('requests the correct URL and returns the parsed JSON body on success', async () => {
    const fixture = { filings: { recent: { accessionNumber: [], filingDate: [], form: [], primaryDocument: [] } } };
    const scope = nock(SEC_HOST).get(`/submissions/CIK${PADDED_CIK}.json`).reply(200, fixture);

    const result = await fetchSubmissions(CIK);

    expect(result).toEqual(fixture);
    expect(scope.isDone()).toBe(true);
  });

  test('throws SubmissionsNotFoundError on a 404', async () => {
    nock(SEC_HOST).get(`/submissions/CIK${PADDED_CIK}.json`).reply(404);
    await expect(fetchSubmissions(CIK)).rejects.toBeInstanceOf(SubmissionsNotFoundError);
  });
});

describe('secFetch (retry/rate-limit wiring)', () => {
  test('a single successful request returns the response with no retry involved', async () => {
    nock(SEC_HOST).get('/probe').reply(200, { ok: true });
    const response = await secFetch(`${SEC_HOST}/probe`);
    expect(response.status).toBe(200);
  });

  test('a transient 500 is retried and the eventual success is returned (proves secFetch really delegates to fetchWithRetry)', async () => {
    // Real production behavior, not a test artifact: nock only defines 2
    // responses, so if secFetch retried more than once here the 3rd request
    // would hit "no matching interceptor" and fail loudly via
    // nock.disableNetConnect() - the test would catch over-retrying too.
    const scope = nock(SEC_HOST).get('/probe-retry').reply(500).get('/probe-retry').reply(200, { ok: true });

    const response = await secFetch(`${SEC_HOST}/probe-retry`);

    expect(response.status).toBe(200);
    expect(scope.isDone()).toBe(true);
  });
});

describe('fetchWithRetry (direct - fast, via an injected no-op sleep)', () => {
  const noSleep = async () => {};

  test('retries on a 5xx response and returns the eventual success', async () => {
    nock(SEC_HOST).get('/x').reply(503).get('/x').reply(200, { ok: true });

    const response = await fetchWithRetry(() => fetch(`${SEC_HOST}/x`), { sleep: noSleep });

    expect(response.status).toBe(200);
  });

  test('does NOT retry a 404 - returns it immediately as the final response', async () => {
    const scope = nock(SEC_HOST).get('/x').reply(404); // only ONE interceptor defined

    const response = await fetchWithRetry(() => fetch(`${SEC_HOST}/x`), { sleep: noSleep });

    expect(response.status).toBe(404);
    expect(scope.isDone()).toBe(true); // exactly 1 request was made, not more
  });

  test('retries a genuine network-level error (not just a bad status code)', async () => {
    nock(SEC_HOST).get('/x').replyWithError('socket hang up').get('/x').reply(200, { ok: true });

    const response = await fetchWithRetry(() => fetch(`${SEC_HOST}/x`), { sleep: noSleep });

    expect(response.status).toBe(200);
  });

  test('exhausts retries on a persistent 5xx and returns that final response rather than throwing', async () => {
    // Confirmed by directly tracing retry.ts before writing this assertion,
    // not assumed: on the LAST attempt, `attempt < maxRetries` is false, so
    // the retryable-status branch is skipped entirely and the function
    // falls through to `return response` - it resolves with the final bad
    // response rather than throwing, even though every attempt was a 5xx.
    // maxRetries overridden to 1 (2 total attempts) so the fixture only
    // needs 2 mocked responses.
    nock(SEC_HOST).get('/x').times(2).reply(500);

    const response = await fetchWithRetry(() => fetch(`${SEC_HOST}/x`), { sleep: noSleep, maxRetries: 1 });
    expect(response.status).toBe(500);
  });

  test('exhausts retries and throws only when every attempt is a network-level error (not a bad status)', async () => {
    nock(SEC_HOST).get('/x').times(2).replyWithError('socket hang up');

    await expect(fetchWithRetry(() => fetch(`${SEC_HOST}/x`), { sleep: noSleep, maxRetries: 1 })).rejects.toThrow();
  });
});
