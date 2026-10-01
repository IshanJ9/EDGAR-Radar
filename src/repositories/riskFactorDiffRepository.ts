import { pool, Queryable } from '../db';
import { cacheKeys, responseCache } from '../cache';
import { padCik } from '../sec';
import { RiskFactorDiffResult } from '../riskFactorDiff';

export interface StoredRiskFactorDiff {
  cik: string;
  currentAccn: string;
  currentFilingDate: string;
  priorAccn: string;
  priorFilingDate: string;
  summary: RiskFactorDiffResult['summary'];
  chunks: RiskFactorDiffResult['chunks'];
  computedAt: string;
}

/** Keyed on the specific (cik, currentAccn, priorAccn) pair, so recomputing the same comparison updates in place rather than duplicating. */
export async function upsertRiskFactorDiff(
  cik: string,
  currentAccn: string,
  currentFilingDate: string,
  priorAccn: string,
  priorFilingDate: string,
  result: RiskFactorDiffResult,
): Promise<void> {
  await pool.query(
    `INSERT INTO filing_risk_factor_diffs (cik, current_accn, current_filing_date, prior_accn, prior_filing_date, summary, chunks)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (cik, current_accn, prior_accn)
     DO UPDATE SET summary = EXCLUDED.summary, chunks = EXCLUDED.chunks, computed_at = now()`,
    [padCik(cik), currentAccn, currentFilingDate, priorAccn, priorFilingDate, JSON.stringify(result.summary), JSON.stringify(result.chunks)],
  );
  await responseCache.invalidate(cacheKeys.riskFactorDiff(cik));
}

/** Whether this exact comparison (current 10-K against prior 10-K) is already stored. */
export async function hasRiskFactorDiff(cik: string, currentAccn: string, priorAccn: string, db: Queryable = pool): Promise<boolean> {
  const result = await db.query(
    'SELECT 1 FROM filing_risk_factor_diffs WHERE cik = $1 AND current_accn = $2 AND prior_accn = $3',
    [padCik(cik), currentAccn, priorAccn],
  );
  return result.rows.length > 0;
}

/** Deletes one stored comparison - used when a recompute finds its Risk Factors section no longer extracts (F1c-2). */
export async function deleteRiskFactorDiff(cik: string, currentAccn: string, priorAccn: string): Promise<void> {
  await pool.query('DELETE FROM filing_risk_factor_diffs WHERE cik = $1 AND current_accn = $2 AND prior_accn = $3', [padCik(cik), currentAccn, priorAccn]);
  await responseCache.invalidate(cacheKeys.riskFactorDiff(cik));
}

/** Returns the most recently computed diff for a company (by current_filing_date), or null if none exists yet. */
export async function getLatestRiskFactorDiff(cik: string, db: Queryable = pool): Promise<StoredRiskFactorDiff | null> {
  const result = await db.query(
    `SELECT cik, current_accn, current_filing_date, prior_accn, prior_filing_date, summary, chunks, computed_at
     FROM filing_risk_factor_diffs
     WHERE cik = $1
     ORDER BY current_filing_date DESC
     LIMIT 1`,
    [padCik(cik)],
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    cik: row.cik,
    currentAccn: row.current_accn,
    currentFilingDate: row.current_filing_date,
    priorAccn: row.prior_accn,
    priorFilingDate: row.prior_filing_date,
    summary: row.summary,
    chunks: row.chunks,
    computedAt: row.computed_at,
  };
}
