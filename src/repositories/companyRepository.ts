import { pool } from '../db';
import { fetchCompanyFacts, mostRecentFact, padCik, REVENUE_TAGS, NET_INCOME_TAGS, UsGaapFact } from '../sec';

async function upsertCompany(cik: string, entityName: string): Promise<void> {
  await pool.query(
    `INSERT INTO companies (cik, entity_name)
     VALUES ($1, $2)
     ON CONFLICT (cik) DO UPDATE SET entity_name = EXCLUDED.entity_name, updated_at = now()`,
    [cik, entityName],
  );
}

async function upsertFact(cik: string, tag: string, fact: UsGaapFact): Promise<void> {
  await pool.query(
    `INSERT INTO filing_facts (cik, tag, unit, value, period_start, period_end, fiscal_year, fiscal_period, form, accn, filed_date)
     VALUES ($1, $2, 'USD', $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (cik, tag, unit, period_end, COALESCE(period_start, '0001-01-01'))
     DO UPDATE SET value = EXCLUDED.value, form = EXCLUDED.form, accn = EXCLUDED.accn, filed_date = EXCLUDED.filed_date, updated_at = now()`,
    [cik, tag, fact.val, fact.start ?? null, fact.end, fact.fy, fact.fp, fact.form, fact.accn, fact.filed],
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
}

export async function getFactsByCik(cik: string): Promise<FactRecord[]> {
  const result = await pool.query(
    `SELECT tag, unit, value, period_start, period_end, fiscal_year, fiscal_period, form, accn, filed_date
     FROM filing_facts WHERE cik = $1 ORDER BY tag, period_end`,
    [padCik(cik)],
  );
  return result.rows;
}
