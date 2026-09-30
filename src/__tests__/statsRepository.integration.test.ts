/**
 * Integration tests for src/repositories/statsRepository.ts (post-Phase 7
 * hardening, step 3), against a real, throwaway Postgres
 * (scripts/runIntegrationTests.ts). publicApi.test.ts stubs this layer; this
 * is where its SQL actually runs.
 *
 * Only ever run via `npm run test:integration`, never `npm test`.
 */
import { pool } from '../db';
import { getPipelineStats, getRecentFilings } from '../repositories/statsRepository';

beforeEach(async () => {
  await pool.query(
    'TRUNCATE TABLE companies, poller_runs, reconciliation_runs, discovered_filings RESTART IDENTITY CASCADE',
  );
});

afterAll(async () => {
  await pool.end();
});

async function discover(accn: string, form: string, hoursAgo: number): Promise<void> {
  await pool.query(
    `INSERT INTO discovered_filings (accession_number, cik, form, filing_date, discovered_at)
     VALUES ($1, '0000320193', $2, '2026-10-01', now() - $3 * interval '1 hour')`,
    [accn, form, hoursAgo],
  );
}

describe('getPipelineStats', () => {
  test('an empty database: zero counts and no runs yet', async () => {
    expect(await getPipelineStats(pool)).toEqual({
      companiesStored: 0,
      factsStored: 0,
      filingsDiscoveredLast24h: 0,
      lastPoll: null,
      lastReconciliation: null,
    });
  });

  test('counts, and the latest COMPLETED poll and reconciliation - not a running or failed one', async () => {
    await pool.query(`INSERT INTO companies (cik, entity_name) VALUES ('0000320193', 'Apple Inc.')`);
    await pool.query(
      `INSERT INTO poller_runs (status, finished_at, companies_checked, new_filings_found) VALUES
         ('completed', '2026-10-01T09:01:38Z', 196, 2),
         ('completed', '2026-10-01T10:01:38Z', 196, 5),
         ('failed',    '2026-10-01T10:31:00Z', 12, 0)`,
    );
    await pool.query(`INSERT INTO poller_runs (status) VALUES ('running')`);
    await pool.query(
      `INSERT INTO reconciliation_runs (status, finished_at, companies_checked, discrepancies_found) VALUES
         ('completed', '2026-10-01T02:02:10Z', 196, 0)`,
    );
    await discover('a-1', '4', 1);
    await discover('a-2', '8-K', 23);
    await discover('a-3', '4', 25); // outside the last 24 hours

    const stats = await getPipelineStats(pool);

    expect(stats).toEqual({
      companiesStored: 1,
      factsStored: 0,
      filingsDiscoveredLast24h: 2,
      lastPoll: { finishedAt: '2026-10-01T10:01:38.000Z', companiesChecked: 196, newFilingsFound: 5 },
      lastReconciliation: { finishedAt: '2026-10-01T02:02:10.000Z', companiesChecked: 196, discrepanciesFound: 0 },
    });
  });
});

describe('getRecentFilings', () => {
  test('returns the window only, newest first, with the filing date as a plain date', async () => {
    await discover('old', '10-K', 30);
    await discover('newer', '4', 1);
    await discover('newest', '8-K', 0.5);

    const filings = await getRecentFilings(24, pool);

    expect(filings.map((f) => f.accessionNumber)).toEqual(['newest', 'newer']);
    expect(filings[0]).toMatchObject({ cik: '0000320193', form: '8-K', filingDate: '2026-10-01' });
    expect(new Date(filings[0]!.discoveredAt).toISOString()).toBe(filings[0]!.discoveredAt);
  });

  test('a longer window includes older filings', async () => {
    await discover('old', '10-K', 30);
    expect((await getRecentFilings(48, pool)).map((f) => f.accessionNumber)).toEqual(['old']);
  });
});
