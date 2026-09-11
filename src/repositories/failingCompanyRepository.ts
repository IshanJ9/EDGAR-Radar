import { pool } from '../db';

const MAX_CONSECUTIVE_FAILURES = 5;

export async function isQuarantined(cik: string): Promise<boolean> {
  const result = await pool.query('SELECT quarantined_at FROM failing_companies WHERE cik = $1', [cik]);
  return result.rows.length > 0 && result.rows[0].quarantined_at !== null;
}

/** Records a successful ingestion, clearing any failure streak (and quarantine, if a manual retry succeeded). */
export async function recordSuccess(cik: string): Promise<void> {
  await pool.query(
    `INSERT INTO failing_companies (cik, consecutive_failures, last_error, last_attempted_at, quarantined_at)
     VALUES ($1, 0, NULL, now(), NULL)
     ON CONFLICT (cik) DO UPDATE SET consecutive_failures = 0, last_error = NULL, last_attempted_at = now(), quarantined_at = NULL`,
    [cik],
  );
}

/** Records a failed ingestion attempt, quarantining the company once it crosses the threshold. Returns true if this call caused it to become newly quarantined. */
export async function recordFailure(cik: string, errorMessage: string): Promise<boolean> {
  const result = await pool.query<{ consecutive_failures: number; quarantined_at: Date | null }>(
    `INSERT INTO failing_companies (cik, consecutive_failures, last_error, last_attempted_at)
     VALUES ($1, 1, $2, now())
     ON CONFLICT (cik) DO UPDATE SET
       consecutive_failures = failing_companies.consecutive_failures + 1,
       last_error = EXCLUDED.last_error,
       last_attempted_at = now()
     RETURNING consecutive_failures, quarantined_at`,
    [cik, errorMessage],
  );

  const row = result.rows[0]!;
  if (row.consecutive_failures >= MAX_CONSECUTIVE_FAILURES && row.quarantined_at === null) {
    await pool.query(`UPDATE failing_companies SET quarantined_at = now() WHERE cik = $1`, [cik]);
    return true;
  }
  return false;
}

export async function clearQuarantine(cik: string): Promise<void> {
  await pool.query(
    `UPDATE failing_companies SET consecutive_failures = 0, quarantined_at = NULL WHERE cik = $1`,
    [cik],
  );
}

export interface QuarantinedCompany {
  cik: string;
  consecutiveFailures: number;
  lastError: string | null;
  quarantinedAt: Date;
}

export async function getQuarantinedCompanies(): Promise<QuarantinedCompany[]> {
  const result = await pool.query(
    `SELECT cik, consecutive_failures, last_error, quarantined_at FROM failing_companies WHERE quarantined_at IS NOT NULL ORDER BY quarantined_at`,
  );
  return result.rows.map((r) => ({
    cik: r.cik,
    consecutiveFailures: r.consecutive_failures,
    lastError: r.last_error,
    quarantinedAt: r.quarantined_at,
  }));
}
