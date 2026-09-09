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
    `INSERT INTO filing_facts (cik, tag, unit, value, period_end, fiscal_year, fiscal_period, form, filed_date)
     VALUES ($1, $2, 'USD', $3, $4, $5, $6, $7, $8)
     ON CONFLICT (cik, tag, unit, period_end, form)
     DO UPDATE SET value = EXCLUDED.value, filed_date = EXCLUDED.filed_date, updated_at = now()`,
    [cik, tag, fact.val, fact.end, fact.fy, fact.fp, fact.form, fact.filed],
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
