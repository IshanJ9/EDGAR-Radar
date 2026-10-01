/**
 * Integration tests for the poller's discovered-filings record (Post-Phase 7,
 * step 5), against a real, throwaway Postgres (scripts/runIntegrationTests.ts).
 * poller.test.ts mocks this layer; this is where its SQL actually runs.
 *
 * Only ever run via `npm run test:integration`, never `npm test`.
 */
import { pool } from '../db';
import { completePollerRun, findDiscoveredAccessions, recordDiscoveredFiling, startPollerRun } from '../repositories/pollerRepository';

const FILING = { accessionNumber: '0000320193-26-000100', cik: '0000320193', form: '4', filingDate: '2026-09-28' };

beforeEach(async () => {
  await pool.query('TRUNCATE TABLE discovered_filings');
});

afterAll(async () => {
  await pool.end();
});

test('a recorded filing is reported as discovered; others are not', async () => {
  await recordDiscoveredFiling(FILING);

  const found = await findDiscoveredAccessions([FILING.accessionNumber, '0000789019-26-000200']);

  expect([...found]).toEqual([FILING.accessionNumber]);
});

test('recording the same filing twice keeps one row and does not throw', async () => {
  await recordDiscoveredFiling(FILING);
  await recordDiscoveredFiling(FILING);

  const { rows } = await pool.query('SELECT accession_number, cik, form, filing_date::text AS filing_date FROM discovered_filings');
  expect(rows).toEqual([{ accession_number: FILING.accessionNumber, cik: FILING.cik, form: '4', filing_date: '2026-09-28' }]);
});

test('an empty list returns an empty set', async () => {
  expect((await findDiscoveredAccessions([])).size).toBe(0);
});

// Post-Phase 7 hardening, step 5.
describe('completePollerRun - failed checks', () => {
  test('stores how many companies could not be checked; a run recorded before the column existed reads 0', async () => {
    await pool.query('TRUNCATE TABLE poller_runs RESTART IDENTITY');
    const legacy = await startPollerRun();
    await pool.query(`UPDATE poller_runs SET status = 'completed', finished_at = now(), companies_checked = 196 WHERE id = $1`, [legacy]);
    const runId = await startPollerRun();

    await completePollerRun(runId, 196, 3, 190);

    const rows = await pool.query('SELECT id, companies_checked, new_filings_found, companies_failed FROM poller_runs ORDER BY id');
    expect(rows.rows).toEqual([
      { id: legacy, companies_checked: 196, new_filings_found: 0, companies_failed: 0 },
      { id: runId, companies_checked: 196, new_filings_found: 3, companies_failed: 190 },
    ]);
  });
});
