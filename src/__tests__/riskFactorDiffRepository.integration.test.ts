/**
 * Integration tests for the queries the risk-factor diff (post-Phase 7
 * hardening, step 3, F1c and F1c-2) relies on - `hasRiskFactorDiff`,
 * `getFilingTextsByAccn`, `deleteRiskFactorDiff` and `getLatestFilingTexts`
 * - against a real, throwaway Postgres
 * (scripts/runIntegrationTests.ts). riskFactorDiffService.test.ts mocks them;
 * this is where their SQL actually runs.
 *
 * Only ever run via `npm run test:integration`, never `npm test`.
 */
import { pool } from '../db';
import { hasRiskFactorDiff, upsertRiskFactorDiff, deleteRiskFactorDiff } from '../repositories/riskFactorDiffRepository';
import { getFilingTextsByAccn, getLatestFilingTexts } from '../repositories/filingTextRepository';
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

// F1c-2: recomputing diffs from stored texts after the extraction fix.
describe('deleteRiskFactorDiff', () => {
  test('deletes only that comparison', async () => {
    const result = { summary: {}, chunks: [] } as unknown as RiskFactorDiffResult;
    await upsertRiskFactorDiff(APPLE, 'k-2025', '2025-10-31', 'k-2024', '2024-11-01', result);
    await upsertRiskFactorDiff(APPLE, 'k-2024', '2024-11-01', 'k-2023', '2023-11-03', result);
    await upsertRiskFactorDiff('0000019617', 'k-2025', '2025-10-31', 'k-2024', '2024-11-01', result);

    await deleteRiskFactorDiff('320193', 'k-2025', 'k-2024');

    expect(await hasRiskFactorDiff(APPLE, 'k-2025', 'k-2024')).toBe(false);
    expect(await hasRiskFactorDiff(APPLE, 'k-2024', 'k-2023')).toBe(true);
    expect(await hasRiskFactorDiff('0000019617', 'k-2025', 'k-2024')).toBe(true);
  });
});

describe('getLatestFilingTexts', () => {
  test("returns a company's newest stored full texts of the form, newest first, as YYYY-MM-DD dates", async () => {
    await pool.query(
      `INSERT INTO filing_text_sections (cik, accn, form, filing_date, section_name, content) VALUES
         ($1, 'k-2023', '10-K', '2023-11-03', 'full_document', 'text 2023'),
         ($1, 'k-2025', '10-K', '2025-10-31', 'full_document', 'text 2025'),
         ($1, 'q-2026', '10-Q', '2026-01-30', 'full_document', 'a quarterly report'),
         ($1, 'k-2024', '10-K', '2024-11-01', 'full_document', 'text 2024'),
         ($1, 'k-2025', '10-K', '2025-10-31', 'risk_factors', 'a section, not the full text'),
         ('0000019617', 'k-2026', '10-K', '2026-02-14', 'full_document', 'another company')`,
      [APPLE],
    );

    const texts = await getLatestFilingTexts('320193', ['10-K'], 2);

    expect(texts).toEqual([
      { accn: 'k-2025', filingDate: '2025-10-31', content: 'text 2025' },
      { accn: 'k-2024', filingDate: '2024-11-01', content: 'text 2024' },
    ]);
  });
});
