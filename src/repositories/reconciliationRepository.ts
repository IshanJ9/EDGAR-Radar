import { pool } from '../db';

export async function startReconciliationRun(): Promise<number> {
  const result = await pool.query<{ id: number }>(`INSERT INTO reconciliation_runs DEFAULT VALUES RETURNING id`);
  return result.rows[0]!.id;
}

export async function completeReconciliationRun(
  runId: number,
  companiesChecked: number,
  companiesMissingFromBulk: number,
  discrepanciesFound: number,
): Promise<void> {
  await pool.query(
    `UPDATE reconciliation_runs
     SET status = 'completed', finished_at = now(),
         companies_checked = $2, companies_missing_from_bulk = $3, discrepancies_found = $4
     WHERE id = $1`,
    [runId, companiesChecked, companiesMissingFromBulk, discrepanciesFound],
  );
}

export async function failReconciliationRun(runId: number): Promise<void> {
  await pool.query(`UPDATE reconciliation_runs SET status = 'failed', finished_at = now() WHERE id = $1`, [runId]);
}
