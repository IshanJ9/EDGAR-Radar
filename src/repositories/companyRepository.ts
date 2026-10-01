import { pool, Queryable } from '../db';
import { cacheKeys, responseCache } from '../cache';
import {
  fetchCompanyFacts,
  mostRecentFact,
  annualFacts,
  padCik,
  REVENUE_TAGS,
  NET_INCOME_TAGS,
  ASSETS_TAGS,
  LIABILITIES_TAGS,
  CURRENT_ASSETS_TAGS,
  CURRENT_LIABILITIES_TAGS,
  RETAINED_EARNINGS_TAGS,
  OPERATING_INCOME_TAGS,
  STOCKHOLDERS_EQUITY_TAGS,
  OPERATING_CASH_FLOW_TAGS,
  LONG_TERM_DEBT_TAGS,
  SHARES_OUTSTANDING_TAGS,
  GROSS_PROFIT_TAGS,
  RECEIVABLES_TAGS,
  PPE_TAGS,
  DEPRECIATION_TAGS,
  SGA_TAGS,
  COST_OF_REVENUE_TAGS,
  SELLING_MARKETING_TAGS,
  GENERAL_ADMIN_TAGS,
  UsGaapFact,
  fiscalYearOfPeriod,
} from '../sec';
import { validateFact } from '../dataQuality';

// Phase 5's ratio scores (Altman Z", Piotroski F-Score, Beneish M-Score)
// each need 2 fiscal years of several balance-sheet/income-statement line
// items. This is purely additive to the existing single-most-recent
// Revenue/NetIncomeLoss storage below - same idempotent EAV table, no
// schema change, and no extra SEC calls (fetchCompanyFacts already returns
// this data, it just wasn't being extracted before).
const ANNUAL_FACT_CONCEPTS: { tags: string[]; unit: 'USD' | 'shares' }[] = [
  { tags: REVENUE_TAGS, unit: 'USD' },
  { tags: NET_INCOME_TAGS, unit: 'USD' },
  { tags: ASSETS_TAGS, unit: 'USD' },
  { tags: LIABILITIES_TAGS, unit: 'USD' },
  { tags: CURRENT_ASSETS_TAGS, unit: 'USD' },
  { tags: CURRENT_LIABILITIES_TAGS, unit: 'USD' },
  { tags: RETAINED_EARNINGS_TAGS, unit: 'USD' },
  { tags: OPERATING_INCOME_TAGS, unit: 'USD' },
  { tags: STOCKHOLDERS_EQUITY_TAGS, unit: 'USD' },
  { tags: OPERATING_CASH_FLOW_TAGS, unit: 'USD' },
  { tags: LONG_TERM_DEBT_TAGS, unit: 'USD' },
  { tags: SHARES_OUTSTANDING_TAGS, unit: 'shares' },
  { tags: GROSS_PROFIT_TAGS, unit: 'USD' },
  { tags: RECEIVABLES_TAGS, unit: 'USD' },
  { tags: PPE_TAGS, unit: 'USD' },
  { tags: DEPRECIATION_TAGS, unit: 'USD' },
  { tags: SGA_TAGS, unit: 'USD' },
  // The parts scoring derives gross profit and SG&A from when a company
  // reports no combined figure (post-Phase 7 hardening, step 3, F1b-2).
  { tags: COST_OF_REVENUE_TAGS, unit: 'USD' },
  { tags: SELLING_MARKETING_TAGS, unit: 'USD' },
  { tags: GENERAL_ADMIN_TAGS, unit: 'USD' },
];
// Five years, not the two a score needs (post-Phase 7 hardening, step 3):
// enough for the frontend's charts to show a trend.
const ANNUAL_HISTORY_YEARS = 5;

async function upsertCompany(cik: string, entityName: string): Promise<void> {
  await pool.query(
    `INSERT INTO companies (cik, entity_name)
     VALUES ($1, $2)
     ON CONFLICT (cik) DO UPDATE SET entity_name = EXCLUDED.entity_name, updated_at = now()`,
    [cik, entityName],
  );
  // Both bodies carry the company's name. Invalidation lives here, at the
  // write itself, so every writer is covered - the API, the parser worker, and
  // the host scripts - rather than only the paths that emit `filing.parsed`.
  // See src/cache.ts.
  await responseCache.invalidate(cacheKeys.company(cik), cacheKeys.facts(cik));
}

async function insertQuarantinedFact(cik: string, tag: string, unit: string, fact: UsGaapFact, reason: string): Promise<void> {
  await pool.query(
    `INSERT INTO quarantined_facts (cik, tag, unit, raw_value, period_start, period_end, fiscal_year, fiscal_period, form, accn, filed_date, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      cik,
      tag,
      unit,
      String(fact.val),
      fact.start ?? null,
      fact.end,
      String(fact.fy),
      fact.fp,
      fact.form,
      fact.accn,
      fact.filed,
      reason,
    ],
  );
}

export async function upsertFact(cik: string, tag: string, fact: UsGaapFact, unit: string = 'USD'): Promise<void> {
  const validation = validateFact(unit, fact);
  if (!validation.valid) {
    await insertQuarantinedFact(cik, tag, unit, fact, validation.reason!);
    return;
  }

  // Keyed on accn (not just period), so a genuine restatement - the same
  // period reported again under a *different* filing - appends a new row
  // instead of overwriting the prior one. Re-ingesting the exact same
  // filing (same accn) still idempotently updates that one row rather than
  // duplicating it. effective_from records when this value became the
  // known-true figure (the filing's own filed date).
  //
  // An annual 10-K value is labelled with the fiscal year of its PERIOD, not
  // SEC's `fy` (the fiscal year of the filing, which a 10-K's comparative
  // columns share - see annualFacts in sec.ts). Every path that stores a 10-K
  // value goes through here, so the label is right whichever one stored it,
  // and a re-ingest corrects a row stored under the old label.
  const fiscalYear = fact.form === '10-K' && fact.fp === 'FY' ? fiscalYearOfPeriod(fact.end) : fact.fy;
  await pool.query(
    `INSERT INTO filing_facts (cik, tag, unit, value, period_start, period_end, fiscal_year, fiscal_period, form, accn, filed_date, effective_from)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
     ON CONFLICT (cik, tag, unit, period_end, COALESCE(period_start, '0001-01-01'), accn)
     DO UPDATE SET value = EXCLUDED.value, form = EXCLUDED.form, filed_date = EXCLUDED.filed_date,
                   fiscal_year = EXCLUDED.fiscal_year, updated_at = now()`,
    [cik, tag, unit, fact.val, fact.start ?? null, fact.end, fiscalYear, fact.fp, fact.form, fact.accn, fact.filed],
  );
  // Called directly by reconciliation as well as by upsertCompanyFacts, so it
  // invalidates for itself. (A quarantined fact returns above without
  // touching filing_facts, so it has nothing to invalidate.) The company's
  // scores are computed from its facts, so they go too. The 196-company list
  // is deliberately NOT cleared here: the parser worker writes facts for every
  // filing it processes, so on a busy day that kept the list (1.5-2.2 s to
  // rebuild) permanently cold. Its ratings expire with the TTL instead. The
  // company page's financials (F3) are built from the same facts, so they go too.
  await responseCache.invalidate(cacheKeys.facts(cik), cacheKeys.scores(cik), cacheKeys.financials(cik));
}

/**
 * Fetches a company's XBRL facts from SEC and upserts the company record plus
 * its most recent Revenue/NetIncomeLoss facts into Postgres.
 */
export async function upsertCompanyFacts(cik: string): Promise<{ cik: string; entityName: string }> {
  return storeCompanyFacts(cik, await fetchCompanyFacts(cik));
}

/**
 * Stores a company and its facts from a companyfacts document already in
 * hand - fetched from SEC by upsertCompanyFacts, or read from SEC's nightly
 * bulk file by scripts/backfillFromBulk.ts, which re-ingests the whole
 * universe without a single per-company request (post-Phase 7 hardening,
 * step 3, F1b-2).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- same untyped raw companyfacts JSON as fetchCompanyFacts.
export async function storeCompanyFacts(cik: string, data: any): Promise<{ cik: string; entityName: string }> {
  const paddedCik = padCik(cik);

  await upsertCompany(paddedCik, data.entityName);

  const revenue = mostRecentFact(data, REVENUE_TAGS);
  const netIncome = mostRecentFact(data, NET_INCOME_TAGS);

  if (revenue) {
    await upsertFact(paddedCik, revenue.tag, revenue.fact);
  }
  if (netIncome) {
    await upsertFact(paddedCik, netIncome.tag, netIncome.fact);
  }

  for (const concept of ANNUAL_FACT_CONCEPTS) {
    const result = annualFacts(data, concept.tags, concept.unit, ANNUAL_HISTORY_YEARS);
    if (!result) continue;
    for (const fact of result.facts) {
      await upsertFact(paddedCik, result.tag, fact, result.unit);
    }
  }

  return { cik: paddedCik, entityName: data.entityName };
}

export interface CompanyRecord {
  cik: string;
  entityName: string;
  /** SEC's industry description, e.g. "National Commercial Banks"; null until the poller has seen the company. */
  industry: string | null;
}

export async function getCompanyByCik(cik: string, db: Queryable = pool): Promise<CompanyRecord | null> {
  const result = await db.query('SELECT cik, entity_name, sic_description FROM companies WHERE cik = $1', [padCik(cik)]);
  if (result.rows.length === 0) return null;
  return { cik: result.rows[0].cik, entityName: result.rows[0].entity_name, industry: result.rows[0].sic_description ?? null };
}

/**
 * Records a company's industry (post-Phase 7 hardening, step 3, F1b), from the
 * submissions document the poller already downloads every cycle. Writes - and
 * clears the cached company responses - only when it actually changed, so
 * 196 checks every 30 minutes cost 196 no-op UPDATEs, not 196 cache clears.
 * A company not stored yet is left alone.
 */
export async function updateCompanyIndustry(cik: string, sic: string, sicDescription: string): Promise<void> {
  const paddedCik = padCik(cik);
  const result = await pool.query(
    `UPDATE companies SET sic = $2, sic_description = $3, updated_at = now()
     WHERE cik = $1 AND (sic IS DISTINCT FROM $2 OR sic_description IS DISTINCT FROM $3)`,
    [paddedCik, sic, sicDescription],
  );
  if (result.rowCount) {
    await responseCache.invalidate(cacheKeys.company(paddedCik), cacheKeys.facts(paddedCik));
  }
}

/**
 * When the company's latest annual report was filed, as YYYY-MM-DD - the
 * newest filed date among its stored 10-K facts - or null if none is stored.
 * For the company page (post-Phase 7 hardening, step 3, F3).
 */
export async function getLatestAnnualReportFiledDate(cik: string, db: Queryable = pool): Promise<string | null> {
  const result = await db.query<{ filed: string | null }>(
    `SELECT max(filed_date)::text AS filed FROM filing_facts WHERE cik = $1 AND form = '10-K'`,
    [padCik(cik)],
  );
  return result.rows[0]?.filed ?? null;
}

/** Every stored company's industry, by padded CIK - for the company list. */
export async function getIndustries(db: Queryable = pool): Promise<Map<string, string>> {
  const result = await db.query<{ cik: string; sic_description: string }>(
    'SELECT cik, sic_description FROM companies WHERE sic_description IS NOT NULL',
  );
  return new Map(result.rows.map((row) => [row.cik, row.sic_description]));
}

export interface FactRecord {
  tag: string;
  unit: string;
  value: string;
  period_start: string | null;
  period_end: string;
  fiscal_year: number | null;
  fiscal_period: string | null;
  form: string | null;
  accn: string;
  filed_date: string | null;
  effective_from: string;
}

/**
 * Returns the current (most recently effective) value for each distinct
 * period - filing_facts can hold multiple rows per period now (one per
 * restatement), so this picks the latest one per (tag, period) rather than
 * returning every historical version to API consumers.
 */
export async function getFactsByCik(cik: string, db: Queryable = pool): Promise<FactRecord[]> {
  const result = await db.query<FactRecord>(
    `SELECT DISTINCT ON (tag, unit, period_end, period_start)
            tag, unit, value, period_start, period_end, fiscal_year, fiscal_period, form, accn, filed_date, effective_from
     FROM filing_facts
     WHERE cik = $1
     ORDER BY tag, unit, period_end, period_start, effective_from DESC`,
    [padCik(cik)],
  );
  return result.rows;
}
