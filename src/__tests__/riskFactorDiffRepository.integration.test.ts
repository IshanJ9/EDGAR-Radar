/**
 * Integration tests for the two reads the risk-factor diff (post-Phase 7
 * hardening, step 3, F1c) relies on to skip work - `hasRiskFactorDiff` and
 * `getFilingTextsByAccn` - against a real, throwaway Postgres
 * (scripts/runIntegrationTests.ts). riskFactorDiffService.test.ts mocks them;
 * this is where their SQL actually runs.
 *
 * Only ever run via `npm run test:integration`, never `npm test`.
 */
import { pool } from '../db';
import { hasRiskFactorDiff, upsertRiskFactorDiff } from '../repositories/riskFactorDiffRepository';
import { getFilingTextsByAccn } from '../repositories/filingTextRepository';
import { RiskFactorDiffResult } from '../riskFactorDiff';

const APPLE = '0000320193';

beforeEach(async () => {
  await pool.query('TRUNCATE TABLE companies, filing_text_sections, filing_risk_factor_diffs RESTART IDENTITY CASCADE');
  await pool.query(`INSERT INTO companies (cik, entity_name) VALUES ($1, 'Apple Inc.'), ('0000019617', 'JPMorgan')`, [APPLE]);
});

afterAll(async () => {
  await pool.end();
});

describe('hasRiskFactorDiff', () => {
  test('true only for the exact stored comparison - not the same 10-K against another, nor another company', async () => {
    const result = { summary: {}, chunks: [] } as unknown as RiskFactorDiffResult;
    await upsertRiskFactorDiff(APPLE, 'k-2025', '2025-10-31', 'k-2024', '2024-11-01', result);

    expect(await hasRiskFactorDiff('320193', 'k-2025', 'k-2024')).toBe(true);
    expect(await hasRiskFactorDiff(APPLE, 'k-2025', 'k-2023')).toBe(false);
    expect(await hasRiskFactorDiff(APPLE, 'k-2026', 'k-2025')).toBe(false);
    expect(await hasRiskFactorDiff('0000019617', 'k-2025', 'k-2024')).toBe(false);
  });
});

describe('getFilingTextsByAccn', () => {
  test("returns the stored full text of each asked-for filing, keyed by accession number; others are absent", async () => {
    await pool.query(
      `INSERT INTO filing_text_sections (cik, accn, form, filing_date, section_name, content) VALUES
         ($1, 'k-2025', '10-K', '2025-10-31', 'full_document', 'text 2025'),
         ($1, 'k-2024', '10-K', '2024-11-01', 'full_document', 'text 2024'),
         ($1, 'k-2024', '10-K', '2024-11-01', 'risk_factors', 'a section, not the full text'),
         ('0000019617', 'k-2023', '10-K', '2023-11-03', 'full_document', 'another company')`,
      [APPLE],
    );

    const texts = await getFilingTextsByAccn('320193', ['k-2025', 'k-2024', 'k-2023', 'missing']);

    expect([...texts.keys()].sort()).toEqual(['k-2024', 'k-2025']);
    expect(texts.get('k-2024')!.content).toBe('text 2024');
    expect(texts.get('k-2025')!.accn).toBe('k-2025');
  });
});
