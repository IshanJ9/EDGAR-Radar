import { pool } from '../db';
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
  UsGaapFact,
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
];
const ANNUAL_HISTORY_YEARS = 2;

async function upsertCompany(cik: string, entityName: string): Promise<void> {
  await pool.query(
    `INSERT INTO companies (cik, entity_name)
     VALUES ($1, $2)
     ON CONFLICT (cik) DO UPDATE SET entity_name = EXCLUDED.entity_name, updated_at = now()`,
    [cik, entityName],
  );
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
  await pool.query(
    `INSERT INTO filing_facts (cik, tag, unit, value, period_start, period_end, fiscal_year, fiscal_period, form, accn, filed_date, effective_from)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
     ON CONFLICT (cik, tag, unit, period_end, COALESCE(period_start, '0001-01-01'), accn)
     DO UPDATE SET value = EXCLUDED.value, form = EXCLUDED.form, filed_date = EXCLUDED.filed_date, updated_at = now()`,
    [cik, tag, unit, fact.val, fact.start ?? null, fact.end, fact.fy, fact.fp, fact.form, fact.accn, fact.filed],
  );
}

/**
 * Fetches a company's XBRL facts from SEC and upserts the company record plus
 * its most recent Revenue/NetIncomeLoss facts into Postgres.
 */
export async function upsertCompanyFacts(cik: string): Promise<{ cik: string; entityName: string }> {
  const data = await fetchCompanyFacts(cik);
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
}

export async function getCompanyByCik(cik: string): Promise<CompanyRecord | null> {
  const result = await pool.query('SELECT cik, entity_name FROM companies WHERE cik = $1', [padCik(cik)]);
  if (result.rows.length === 0) return null;
  return { cik: result.rows[0].cik, entityName: result.rows[0].entity_name };
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
export async function getFactsByCik(cik: string): Promise<FactRecord[]> {
  const result = await pool.query(
    `SELECT DISTINCT ON (tag, unit, period_end, period_start)
            tag, unit, value, period_start, period_end, fiscal_year, fiscal_period, form, accn, filed_date, effective_from
     FROM filing_facts
     WHERE cik = $1
     ORDER BY tag, unit, period_end, period_start, effective_from DESC`,
    [padCik(cik)],
  );
  return result.rows;
}
