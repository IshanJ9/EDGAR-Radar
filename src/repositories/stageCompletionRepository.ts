import { pool } from '../db';

/**
 * Atomically claims a (accessionNumber, stage) pair. Returns true if this
 * call is the one that claimed it - the first time this filing has reached
 * this stage, so the caller should go ahead and perform the stage's
 * non-idempotent side effect (enqueue the next stage, send an alert).
 * Returns false if it was already claimed - a redelivered/retried job for
 * a filing that already completed this stage - so the caller should skip
 * the side effect rather than duplicate it.
 */
export async function claimStage(accessionNumber: string, stage: string): Promise<boolean> {
  const result = await pool.query(
    `INSERT INTO stage_completions (accession_number, stage) VALUES ($1, $2)
     ON CONFLICT (accession_number, stage) DO NOTHING
     RETURNING id`,
    [accessionNumber, stage],
  );
  return result.rows.length > 0;
}
