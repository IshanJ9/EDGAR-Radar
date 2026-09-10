import { pool } from '../db';

export interface IngestionRun {
  id: number;
  totalCompanies: number;
}

/**
 * Resumes the most recent 'running' ingestion run if one exists (e.g. the
 * previous invocation was killed mid-backfill), otherwise starts a new run
 * with a full manifest of pending companies. Returns the run and the list
 * of CIKs still needing processing in this run - callers should only touch
 * this subset, not the full universe, so an interrupted-and-resumed run
 * doesn't redo already-successful companies.
 */
export async function startOrResumeRun(allCiks: string[]): Promise<{ run: IngestionRun; pendingCiks: string[] }> {
  const existing = await pool.query<{ id: number; total_companies: number }>(
    `SELECT id, total_companies FROM ingestion_runs WHERE status = 'running' ORDER BY started_at DESC LIMIT 1`,
  );

  if (existing.rows.length > 0) {
    const run = existing.rows[0]!;
    const pending = await pool.query<{ cik: string }>(
      `SELECT cik FROM ingestion_run_companies WHERE run_id = $1 AND status = 'pending' ORDER BY cik`,
      [run.id],
    );
    return {
      run: { id: run.id, totalCompanies: run.total_companies },
      pendingCiks: pending.rows.map((r) => r.cik),
    };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query<{ id: number }>(
      `INSERT INTO ingestion_runs (total_companies) VALUES ($1) RETURNING id`,
      [allCiks.length],
    );
    const runId = inserted.rows[0]!.id;

    for (const cik of allCiks) {
      await client.query(`INSERT INTO ingestion_run_companies (run_id, cik) VALUES ($1, $2)`, [runId, cik]);
    }

    await client.query('COMMIT');
    return { run: { id: runId, totalCompanies: allCiks.length }, pendingCiks: allCiks };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function markCompanySuccess(runId: number, cik: string): Promise<void> {
  await pool.query(
    `UPDATE ingestion_run_companies SET status = 'success', processed_at = now(), error_message = NULL
     WHERE run_id = $1 AND cik = $2`,
    [runId, cik],
  );
}

export async function markCompanyFailed(runId: number, cik: string, errorMessage: string): Promise<void> {
  await pool.query(
    `UPDATE ingestion_run_companies SET status = 'failed', processed_at = now(), error_message = $3
     WHERE run_id = $1 AND cik = $2`,
    [runId, cik, errorMessage],
  );
}

export async function completeRun(runId: number): Promise<void> {
  await pool.query(`UPDATE ingestion_runs SET status = 'completed', finished_at = now() WHERE id = $1`, [runId]);
}

export interface RunSummary {
  total: number;
  success: number;
  failed: number;
  pending: number;
}

export async function getRunSummary(runId: number): Promise<RunSummary> {
  const result = await pool.query<{ status: string; count: string }>(
    `SELECT status, count(*) FROM ingestion_run_companies WHERE run_id = $1 GROUP BY status`,
    [runId],
  );
  const summary: RunSummary = { total: 0, success: 0, failed: 0, pending: 0 };
  for (const row of result.rows) {
    const count = Number(row.count);
    summary.total += count;
    if (row.status === 'success') summary.success = count;
    else if (row.status === 'failed') summary.failed = count;
    else if (row.status === 'pending') summary.pending = count;
  }
  return summary;
}
