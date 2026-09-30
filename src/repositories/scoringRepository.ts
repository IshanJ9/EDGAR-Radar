import { pool } from '../db';
import { padCik } from '../sec';

export interface AnnualValue {
  fiscalYear: number;
  value: number;
}

/**
 * Returns up to `years` most recent distinct-fiscal-year annual values for
 * whichever of `tags` was actually stored for this company (ingestion only
 * ever stores one winning tag per concept - see `annualFacts` in sec.ts -
 * so at most one of the candidates will have rows). Ordered most-recent
 * first: index 0 is the current fiscal year, index 1 the prior one.
 *
 * `DISTINCT ON (fiscal_year)` collapses a restated figure (same fiscal
 * year reported again under a later accn) down to its latest-effective
 * value, matching how `getFactsByCik` already surfaces current values.
 *
 * `beforeFiscalYear`, when given, restricts to fiscal years at or before
 * it - added for Phase 5's back-testing step, which needs a specific
 * historical fiscal-year pair (surrounding a known accounting
 * irregularity), not whatever is most recent as of today.
 */
export async function getAnnualValues(cik: string, tags: string[], years = 2, beforeFiscalYear?: number): Promise<AnnualValue[]> {
  // Post-Phase 7 hardening, step 3 (F1b): only full-year values (a 10-K can
  // also report its fourth quarter, tagged FY), and only ONE tag - the one
  // with the most recent year, then priority order. Rows under an older tag
  // may still be stored from before ingestion preferred the freshest tag, and
  // taking one year from each would compare two different measures.
  const result = await pool.query(
    `WITH annual AS (
       SELECT tag, fiscal_year, value, effective_from
       FROM filing_facts
       WHERE cik = $1 AND tag = ANY($2) AND form = '10-K' AND fiscal_period = 'FY'
         AND (period_start IS NULL OR period_end - period_start BETWEEN 330 AND 400)
         AND ($4::int IS NULL OR fiscal_year <= $4)
     ), chosen AS (
       SELECT tag FROM annual ORDER BY fiscal_year DESC, array_position($2::text[], tag) LIMIT 1
     )
     SELECT fiscal_year, value FROM (
       SELECT DISTINCT ON (fiscal_year) fiscal_year, value, effective_from
       FROM annual WHERE tag = (SELECT tag FROM chosen)
       ORDER BY fiscal_year DESC, effective_from DESC
     ) latest
     ORDER BY fiscal_year DESC
     LIMIT $3`,
    [padCik(cik), tags, years, beforeFiscalYear ?? null],
  );
  return result.rows.map((row) => ({ fiscalYear: row.fiscal_year, value: Number(row.value) }));
}
