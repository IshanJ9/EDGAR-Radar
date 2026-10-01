import { describe, expect, test, vi } from 'vitest';
import { ApiError, fetchCompanies, fetchStats } from './api';

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
