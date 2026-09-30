/**
 * Integration tests for src/repositories/companyRepository.ts (Phase 6,
 * step 4) - run against a real, throwaway Postgres (see
 * scripts/runIntegrationTests.ts), not mocked. This is where the real SQL
 * this project depends on - the upsert's ON CONFLICT logic, restatement
 * handling via effective_from, and the quarantine path - actually gets
 * exercised, complementing step 3's unit tests (which mocked this same
 * repository layer entirely).
 *
 * Only ever run via `npm run test:integration`, never `npm test`.
 */
import { pool } from '../db';
import { upsertFact, getFactsByCik, getCompanyByCik, updateCompanyIndustry, getIndustries } from '../repositories/companyRepository';
import { UsGaapFact } from '../sec';

const CIK = '0000000001';

async function seedCompany(cik: string, entityName = 'Test Company Inc.'): Promise<void> {
  await pool.query('INSERT INTO companies (cik, entity_name) VALUES ($1, $2)', [cik, entityName]);
}

function fact(overrides: Partial<UsGaapFact> = {}): UsGaapFact {
  return {
    end: '2024-12-31',
    val: 1000,
    fy: 2024,
    fp: 'FY',
    form: '10-K',
    filed: '2025-02-01',
    accn: '0000000001-25-000001',
    ...overrides,
  };
}

beforeEach(async () => {
  // companies -> filing_facts cascades (ON DELETE CASCADE); quarantined_facts
  // has no FK (deliberately - see its migration's own comment) so it needs
  // listing explicitly to get the same clean-slate guarantee.
  await pool.query('TRUNCATE TABLE companies, quarantined_facts RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  await pool.end();
});

describe('upsertFact + getFactsByCik', () => {
  // Post-Phase 7 hardening, step 3 (F1b): SEC's `fy` is the fiscal year of the
  // FILING. A 10-K's comparative column (last year's figure) carries this
  // year's `fy`, so storing it as-is mislabelled every restated year.
  test('an annual 10-K value is labelled with the fiscal year of its period, not of the filing', async () => {
    await seedCompany(CIK);
    await upsertFact(CIK, 'Assets', fact({ end: '2023-09-30', fy: 2025, fp: 'FY', form: '10-K' }));

    const [row] = await getFactsByCik(CIK);
    expect(row!.fiscal_year).toBe(2023);
  });

  test('re-ingesting a row stored under the old, wrong label corrects it', async () => {
    await seedCompany(CIK);
    await pool.query(
      `INSERT INTO filing_facts (cik, tag, unit, value, period_end, fiscal_year, fiscal_period, form, accn, filed_date, effective_from)
       VALUES ($1, 'Assets', 'USD', 1000, '2023-09-30', 2025, 'FY', '10-K', '0000000001-25-000001', '2025-02-01', '2025-02-01')`,
      [CIK],
    );

    await upsertFact(CIK, 'Assets', fact({ end: '2023-09-30', fy: 2025, accn: '0000000001-25-000001', filed: '2025-02-01' }));

    const [row] = await getFactsByCik(CIK);
    expect(row!.fiscal_year).toBe(2023);
  });

  test('a quarterly value keeps the fiscal year SEC gives it', async () => {
    await seedCompany(CIK);
    await upsertFact(CIK, 'Revenues', fact({ start: '2026-03-29', end: '2026-06-27', fy: 2026, fp: 'Q3', form: '10-Q' }));

    const [row] = await getFactsByCik(CIK);
    expect(row!.fiscal_year).toBe(2026);
  });

  test('re-ingesting the exact same filing (same accn) updates in place, not a duplicate row', async () => {
    await seedCompany(CIK);
    await upsertFact(CIK, 'Assets', fact({ val: 1000 }));
    await upsertFact(CIK, 'Assets', fact({ val: 1000 })); // identical re-ingest

    const facts = await getFactsByCik(CIK);
    const assetsRows = facts.filter((f) => f.tag === 'Assets');
    expect(assetsRows).toHaveLength(1);
    expect(Number(assetsRows[0]!.value)).toBe(1000);
  });

  test('re-ingesting the same filing with a corrected value updates the existing row rather than appending', async () => {
    await seedCompany(CIK);
    await upsertFact(CIK, 'Assets', fact({ val: 1000 }));
    await upsertFact(CIK, 'Assets', fact({ val: 1234 })); // same accn, corrected value

    const facts = await getFactsByCik(CIK);
    const assetsRows = facts.filter((f) => f.tag === 'Assets');
    expect(assetsRows).toHaveLength(1);
    expect(Number(assetsRows[0]!.value)).toBe(1234);
  });

  test('a genuine restatement (same period, different accn) appends a new row and surfaces the latest effective_from value', async () => {
    await seedCompany(CIK);
    // Original filing.
    await upsertFact(
      CIK,
      'Assets',
      fact({ val: 1000, accn: '0000000001-25-000001', filed: '2025-02-01' }),
    );
    // A later filing restates the SAME fiscal period under a NEW accn -
    // this is the exact real-world case effective_from was added for
    // (see migrations/1789066870652_filing-facts-effective-from.js).
    await upsertFact(
      CIK,
      'Assets',
      fact({ val: 1150, accn: '0000000001-25-000009', filed: '2025-06-01' }),
    );

    // Both historical versions must be preserved as real, separate rows -
    // restating must never silently destroy the original figure. Checked
    // against the raw table directly, since getFactsByCik (below) is
    // supposed to collapse them and would hide data loss either way.
    const rawRows = await pool.query("SELECT value, accn FROM filing_facts WHERE cik = $1 AND tag = 'Assets' ORDER BY effective_from", [CIK]);
    expect(rawRows.rows).toHaveLength(2);

    // getFactsByCik (DISTINCT ON ... ORDER BY ... effective_from DESC) must
    // surface only the latest-effective one as "the" current value - not
    // both, and not the stale pre-restatement figure.
    const facts = await getFactsByCik(CIK);
    const assetsRows = facts.filter((f) => f.tag === 'Assets');
    expect(assetsRows).toHaveLength(1);
    expect(Number(assetsRows[0]!.value)).toBe(1150);
  });

  test('an invalid fact (non-numeric value) is quarantined, not written to filing_facts', async () => {
    await seedCompany(CIK);
    await upsertFact(CIK, 'Assets', fact({ val: Number.NaN }));

    const facts = await getFactsByCik(CIK);
    expect(facts).toHaveLength(0);

    const quarantined = await pool.query('SELECT cik, tag, reason FROM quarantined_facts WHERE cik = $1', [CIK]);
    expect(quarantined.rows).toHaveLength(1);
    expect(quarantined.rows[0].tag).toBe('Assets');
    expect(quarantined.rows[0].reason).toContain('non-numeric');
  });

  test('an implausibly large value is quarantined rather than silently stored', async () => {
    await seedCompany(CIK);
    await upsertFact(CIK, 'Assets', fact({ val: 1e20 })); // far past any real company's balance sheet

    const facts = await getFactsByCik(CIK);
    expect(facts).toHaveLength(0);
    const quarantined = await pool.query('SELECT reason FROM quarantined_facts WHERE cik = $1', [CIK]);
    expect(quarantined.rows[0].reason).toContain('magnitude');
  });
});

describe('getCompanyByCik', () => {
  test('returns null for a company that was never upserted', async () => {
    expect(await getCompanyByCik('0000009999')).toBeNull();
  });

  test('returns the stored record for a real company', async () => {
    await seedCompany(CIK, 'Test Company Inc.');
    const company = await getCompanyByCik(CIK);
    expect(company).toEqual({ cik: CIK, entityName: 'Test Company Inc.', industry: null });
  });
});

describe('updateCompanyIndustry + getIndustries (post-Phase 7 hardening, step 3, F1b)', () => {
  test('records the industry, which the company record and the industry map then carry', async () => {
    await seedCompany(CIK);
    await updateCompanyIndustry(CIK, '6021', 'National Commercial Banks');

    expect((await getCompanyByCik(CIK))!.industry).toBe('National Commercial Banks');
    expect(await getIndustries()).toEqual(new Map([[CIK, 'National Commercial Banks']]));
  });

  test('an unchanged industry is not rewritten', async () => {
    await seedCompany(CIK);
    await updateCompanyIndustry(CIK, '6021', 'National Commercial Banks');
    const { rows: before } = await pool.query('SELECT updated_at FROM companies WHERE cik = $1', [CIK]);

    await updateCompanyIndustry(CIK, '6021', 'National Commercial Banks');

    const { rows: after } = await pool.query('SELECT updated_at FROM companies WHERE cik = $1', [CIK]);
    expect(after[0].updated_at).toEqual(before[0].updated_at);
  });

  test('a company that is not stored is left alone - no row is created', async () => {
    await updateCompanyIndustry('0000009999', '3571', 'Electronic Computers');

    expect(await getCompanyByCik('0000009999')).toBeNull();
    expect((await getIndustries()).size).toBe(0);
  });
});
