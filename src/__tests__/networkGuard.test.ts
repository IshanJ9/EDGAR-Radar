/**
 * Regression test for the network guard in jest.setup.ts - Phase 6 failure
 * case "a flaky, un-mocked, third-party-dependent test in CI is treated as a
 * bug and fixed."
 *
 * An audit for that failure case found no such test in this suite (10 repeat
 * unit runs, 3 repeat integration runs, 5 randomized test orders, no clock or
 * randomness dependence - see PROGRESS.md). What keeps it that way is one line,
 * `nock.disableNetConnect()`, which turns any request a test forgets to mock
 * into a hard failure instead of a real call that passes or fails depending on
 * the network. Nothing verified that line was still there: deleting it would
 * have left CI green while silently allowing tests to reach the internet. This
 * test is what fails instead.
 *
 * It targets example.com, a real host that resolves normally, on purpose. With
 * the guard in place the request is refused before any connection is made
 * (measured at 2ms for fetch and 13ms for https.get). Without it, the request
 * would genuinely succeed from a networked machine and the assertions below
 * would fail - so a pass can only mean the guard is active, never that the
 * network happened to be down.
 *
 * Both clients are covered because they reach the network differently: the
 * SEC client (src/sec.ts) uses Node's built-in fetch, which older nock
 * versions could not intercept at all, while other libraries use `https`.
 */
import https from 'https';

const REAL_HOST_URL = 'https://example.com/';
const GUARD_REFUSAL = /Disallowed net connect/;

describe('network guard (jest.setup.ts)', () => {
  test('refuses a request made with global fetch', async () => {
    // The timeout only matters if the guard is missing: it bounds how long a
    // genuine request can take before this test reports the failure.
    await expect(fetch(REAL_HOST_URL, { signal: AbortSignal.timeout(5000) })).rejects.toThrow(GUARD_REFUSAL);
  });

  test('refuses a request made with https.get', async () => {
    const outcome = await new Promise<string>((resolve) => {
      const req = https.get(REAL_HOST_URL, { timeout: 5000 }, (res) => {
        res.resume();
        resolve(`unexpectedly received HTTP ${res.statusCode}`);
      });
      req.on('timeout', () => req.destroy(new Error('request timed out')));
      req.on('error', (err) => resolve(err.message));
    });
    expect(outcome).toMatch(GUARD_REFUSAL);
  });
});
