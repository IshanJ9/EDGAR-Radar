/**
 * A real, fully end-to-end integration test for computeAltmanZDoublePrime
 * (src/scoring.ts) - Phase 6, step 4. Unlike scoring.test.ts (step 3), NO
 * mocking happens here at all: real rows are seeded into a real, throwaway
 * Postgres, and the actual exported function runs its real SQL
 * (getAnnualValues) and its real formula against them. This is the one
 * test in this project that proves the full path - repository query,
 * ratio math, and classification - genuinely works together end-to-end,
 * closing the gap step 3's mocked version could not.
 *
 * Reuses the exact "safe" fixture numbers already hand-verified in
 * scoring.test.ts (Z" = 9.798), so a passing result here is directly
 * comparable to that already-checked answer rather than a fresh,
 * unverified one.
 *
 * Only ever run via `npm run test:integration`, never `npm test`.
 */
import { pool } from '../db';
import { computeAltmanZDoublePrime } from '../scoring';

const CIK = '0000000003';

async function seedCompany(cik: string): Promise<void> {
  await pool.query('INSERT INTO companies (cik, entity_name) VALUES ($1, $2)', [cik, 'Test Company Inc.']);
}

async function seedFact(cik: string, tag: string, value: number, fiscalYear: number): Promise<void> {
  await pool.query(
    `INSERT INTO filing_facts (cik, tag, unit, value, period_end, fiscal_year, fiscal_period, form, accn, filed_date, effective_from)
     VALUES ($1, $2, 'USD', $3, $4, $5, 'FY', '10-K', $6, $7, $7)`,
    [cik, tag, value, `${fiscalYear}-12-31`, fiscalYear, `acc-${cik}-${tag}`, `${fiscalYear + 1}-02-01`],
  );
}

beforeEach(async () => {
  await pool.query('TRUNCATE TABLE companies, quarantined_facts RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  await pool.end();
});

test('computeAltmanZDoublePrime, run against real seeded rows with no mocking, reproduces the independently-verified "safe" result', async () => {
  await seedCompany(CIK);
  await seedFact(CIK, 'Assets', 1000, 2024);
  await seedFact(CIK, 'AssetsCurrent', 600, 2024);
  await seedFact(CIK, 'LiabilitiesCurrent', 200, 2024);
  await seedFact(CIK, 'RetainedEarningsAccumulatedDeficit', 500, 2024);
  await seedFact(CIK, 'OperatingIncomeLoss', 200, 2024);
  await seedFact(CIK, 'StockholdersEquity', 800, 2024);
  await seedFact(CIK, 'Liabilities', 200, 2024);

  const result = await computeAltmanZDoublePrime(CIK);

  expect(result.status).toBe('ok');
  if (result.status !== 'ok') throw new Error('unreachable');
  expect(result.classification).toBe('safe');
  expect(result.value).toBeCloseTo(9.798, 2);
  expect(result.inputs.fiscalYear).toBe(2024);
  expect(result.inputs.liabilitiesDerived).toBe(false); // a real Liabilities tag was seeded directly
});

test('computeAltmanZDoublePrime derives Liabilities from Assets - Equity against real rows when no Liabilities tag was ever ingested', async () => {
  await seedCompany(CIK);
  await seedFact(CIK, 'Assets', 1000, 2024);
  await seedFact(CIK, 'AssetsCurrent', 300, 2024);
  await seedFact(CIK, 'LiabilitiesCurrent', 200, 2024);
  await seedFact(CIK, 'RetainedEarningsAccumulatedDeficit', 100, 2024);
  await seedFact(CIK, 'OperatingIncomeLoss', 50, 2024);
  await seedFact(CIK, 'StockholdersEquity', 600, 2024);
  // 'Liabilities' deliberately never seeded - mirrors the real AbbVie gap
  // already documented in scoring.ts's own comment.

  const result = await computeAltmanZDoublePrime(CIK);

  expect(result.status).toBe('ok');
  if (result.status !== 'ok') throw new Error('unreachable');
  expect(result.inputs.liabilitiesDerived).toBe(true);
  expect(result.inputs.totalLiabilities).toBe(400); // 1000 - 600
});

test('returns insufficient-history against a real company with no seeded data at all', async () => {
  await seedCompany(CIK);
  const result = await computeAltmanZDoublePrime(CIK);
  expect(result.status).toBe('insufficient-history');
});
