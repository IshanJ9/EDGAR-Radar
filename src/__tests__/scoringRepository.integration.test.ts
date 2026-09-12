/**
 * Integration tests for getAnnualValues (src/repositories/scoringRepository.ts)
 * - Phase 6, step 4. This is the single most SQL-logic-heavy function
 * step 3's unit tests had to mock around entirely (see scoring.test.ts's
 * own comment); here it runs against a real, throwaway Postgres, and the
 * real query - the DISTINCT ON restatement-collapsing, the `beforeFiscalYear`
 * filter, and the `tag = ANY($2)` fallback-list matching - actually executes.
 *
 * Only ever run via `npm run test:integration`, never `npm test`.
 */
import { pool } from '../db';
import { getAnnualValues } from '../repositories/scoringRepository';

const CIK = '0000000002';

async function seedCompany(cik: string): Promise<void> {
  await pool.query('INSERT INTO companies (cik, entity_name) VALUES ($1, $2)', [cik, 'Test Company Inc.']);
}

/** Inserts one filing_facts row directly - the real historical rows getAnnualValues reads. */
async function seedFact(opts: {
  cik: string;
  tag: string;
  value: number;
  fiscalYear: number;
  accn: string;
  effectiveFrom: string;
  form?: string;
  fiscalPeriod?: string;
  periodEnd?: string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO filing_facts (cik, tag, unit, value, period_end, fiscal_year, fiscal_period, form, accn, filed_date, effective_from)
     VALUES ($1, $2, 'USD', $3, $4, $5, $6, $7, $8, $9, $9)`,
    [
      opts.cik,
      opts.tag,
      opts.value,
      opts.periodEnd ?? `${opts.fiscalYear}-12-31`,
      opts.fiscalYear,
      opts.fiscalPeriod ?? 'FY',
      opts.form ?? '10-K',
      opts.accn,
      opts.effectiveFrom,
    ],
  );
}

beforeEach(async () => {
  await pool.query('TRUNCATE TABLE companies, quarantined_facts RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  await pool.end();
});

describe('getAnnualValues', () => {
  test('returns the most recent `years` fiscal years, most-recent first', async () => {
    await seedCompany(CIK);
    for (const [fy, val] of [[2021, 100], [2022, 200], [2023, 300], [2024, 400]] as const) {
      await seedFact({ cik: CIK, tag: 'Assets', value: val, fiscalYear: fy, accn: `acc-${fy}`, effectiveFrom: `${fy}-02-01` });
    }

    const result = await getAnnualValues(CIK, ['Assets'], 2);
    expect(result).toEqual([
      { fiscalYear: 2024, value: 400 },
      { fiscalYear: 2023, value: 300 },
    ]);
  });

  test('collapses a restated fiscal year down to its latest-effective value (DISTINCT ON)', async () => {
    await seedCompany(CIK);
    // Same fiscal year reported twice, under two different filings -
    // exactly the real restatement case this query has to handle.
    await seedFact({ cik: CIK, tag: 'Assets', value: 1000, fiscalYear: 2024, accn: 'acc-original', effectiveFrom: '2025-02-01' });
    await seedFact({ cik: CIK, tag: 'Assets', value: 1150, fiscalYear: 2024, accn: 'acc-restated', effectiveFrom: '2025-06-01' });

    const result = await getAnnualValues(CIK, ['Assets'], 1);
    expect(result).toEqual([{ fiscalYear: 2024, value: 1150 }]);
  });

  test('respects beforeFiscalYear, excluding later fiscal years entirely (used by Phase 5 back-testing)', async () => {
    await seedCompany(CIK);
    for (const fy of [2015, 2016, 2017, 2018]) {
      await seedFact({ cik: CIK, tag: 'Assets', value: fy, fiscalYear: fy, accn: `acc-${fy}`, effectiveFrom: `${fy}-02-01` });
    }

    const result = await getAnnualValues(CIK, ['Assets'], 2, 2016);
    expect(result).toEqual([
      { fiscalYear: 2016, value: 2016 },
      { fiscalYear: 2015, value: 2015 },
    ]);
  });

  test('finds data under any tag in a fallback list, matching whichever one a company actually used', async () => {
    await seedCompany(CIK);
    // Real companies report revenue under different tags depending on era -
    // seed under the SECOND item in a fallback list to prove `tag = ANY($2)`
    // genuinely checks every candidate, not just the first.
    await seedFact({ cik: CIK, tag: 'SalesRevenueNet', value: 500, fiscalYear: 2016, accn: 'acc-1', effectiveFrom: '2017-02-01' });

    const result = await getAnnualValues(CIK, ['RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet'], 1);
    expect(result).toEqual([{ fiscalYear: 2016, value: 500 }]);
  });

  test('only counts annual (form 10-K, fiscal_period FY) facts, ignoring quarterly data', async () => {
    await seedCompany(CIK);
    await seedFact({ cik: CIK, tag: 'Assets', value: 100, fiscalYear: 2024, accn: 'acc-fy', effectiveFrom: '2025-02-01', form: '10-K', fiscalPeriod: 'FY' });
    await seedFact({ cik: CIK, tag: 'Assets', value: 999, fiscalYear: 2024, accn: 'acc-q1', effectiveFrom: '2024-05-01', form: '10-Q', fiscalPeriod: 'Q1', periodEnd: '2024-03-31' });

    const result = await getAnnualValues(CIK, ['Assets'], 2);
    expect(result).toEqual([{ fiscalYear: 2024, value: 100 }]);
  });

  test('returns an empty array when the company has no data for any candidate tag', async () => {
    await seedCompany(CIK);
    expect(await getAnnualValues(CIK, ['NonexistentTag'], 2)).toEqual([]);
  });
});
