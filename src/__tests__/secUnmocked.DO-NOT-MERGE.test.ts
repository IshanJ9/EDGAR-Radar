/**
 * DO NOT MERGE. Throwaway fixture for Phase 6 failure case 3: "a flaky,
 * un-mocked, third-party-dependent test in CI is treated as a bug and fixed."
 *
 * Written the way the mistake really happens: a test that calls the SEC client
 * and asserts on real data, but forgets to set up a nock interceptor. Without
 * the network guard this would call data.sec.gov for real and pass or fail
 * depending on SEC's availability, rate limits and whatever Apple last filed -
 * the definition of a flaky third-party-dependent test. With the guard it
 * should fail every time, with a message naming the URL.
 *
 * Opened as a PR only to prove that on GitHub's runners, then closed unmerged.
 */
import { fetchCompanyFacts } from '../sec';

test('DO NOT MERGE - forgets to mock SEC, so it would depend on the real API', async () => {
  const facts = await fetchCompanyFacts('320193');
  expect(facts.entityName).toBe('Apple Inc.');
});
