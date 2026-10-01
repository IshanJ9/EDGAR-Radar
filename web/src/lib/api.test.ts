import { describe, expect, test, vi } from 'vitest';
import { ApiError, fetchCompanies, fetchFinancials, fetchRiskFactorDiff, fetchScores, fetchStats } from './api';

function respondWith(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('the API client', () => {
  test("calls the site's own /api proxy - never the API's address directly", async () => {
    const fetchMock = respondWith(200, { count: 0, companies: [] });

    await fetchCompanies();

    expect(fetchMock).toHaveBeenCalledWith('/api/companies', expect.anything());
  });

  test('adds a display name to every company', async () => {
    respondWith(200, {
      count: 1,
      companies: [{ cik: '0000789019', ticker: 'MSFT', name: 'MICROSOFT CORP', industry: 'Services-Prepackaged Software', ratings: {} }],
    });

    const companies = await fetchCompanies();

    expect(companies[0]).toMatchObject({ ticker: 'MSFT', name: 'MICROSOFT CORP', displayName: 'Microsoft Corp' });
  });

  test('returns the pipeline stats as served', async () => {
    const stats = { companiesMonitored: 196, factsStored: 16394, filingsDiscoveredLast24h: 400, lastPoll: null, lastReconciliation: null };
    respondWith(200, stats);

    await expect(fetchStats()).resolves.toEqual(stats);
  });

  test('an error status is an ApiError carrying the status, not a silently empty result', async () => {
    respondWith(503, { error: 'Service unavailable' });

    const error = await fetchStats().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 503 });
  });

  test('a network failure is an ApiError too', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));

    await expect(fetchStats()).rejects.toBeInstanceOf(ApiError);
  });
});

// F3: the company page's data.
describe('company page requests', () => {
  test('scores, financials and the risk-factor diff each come from their own endpoint', async () => {
    const fetchMock = respondWith(200, {});

    await fetchScores('0000320193');
    await fetchFinancials('0000320193');
    await fetchRiskFactorDiff('0000320193');

    expect(fetchMock.mock.calls.map((call) => (call as unknown[])[0])).toEqual([
      '/api/companies/0000320193/scores',
      '/api/companies/0000320193/financials',
      '/api/companies/0000320193/risk-factor-diff',
    ]);
  });

  test('no stored risk-factor diff (404) is null - an expected state, not an error', async () => {
    respondWith(404, { error: 'No risk-factor comparison stored for this company yet.' });

    await expect(fetchRiskFactorDiff('0000040545')).resolves.toBeNull();
  });

  test('any other failure of the diff is still an error', async () => {
    respondWith(500, { error: 'Internal server error' });

    await expect(fetchRiskFactorDiff('0000320193')).rejects.toBeInstanceOf(ApiError);
  });
});
