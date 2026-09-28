import { pool } from '../db';

const STATE_ROW_ID = 1;

/**
 * Returns the cursor - the timestamp up to which we've confirmed all filings
 * have been checked. On first-ever run there's no cursor yet; default to 24
 * hours ago rather than the epoch, so the first poll doesn't treat every
 * filing in a company's entire history as "new".
 */
export async function getLastCheckedAt(): Promise<Date> {
  const result = await pool.query<{ last_checked_at: Date }>(
    'SELECT last_checked_at FROM poller_state WHERE id = $1',
    [STATE_ROW_ID],
  );
  if (result.rows.length > 0) {
    return result.rows[0]!.last_checked_at;
  }
  return new Date(Date.now() - 24 * 60 * 60 * 1000);
}

export async function setLastCheckedAt(timestamp: Date): Promise<void> {
  await pool.query(
    `INSERT INTO poller_state (id, last_checked_at) VALUES ($1, $2)
     ON CONFLICT (id) DO UPDATE SET last_checked_at = EXCLUDED.last_checked_at`,
    [STATE_ROW_ID, timestamp],
  );
}

/** Of the given accession numbers, the ones the poller has already enqueued. */
export async function findDiscoveredAccessions(accessionNumbers: string[]): Promise<Set<string>> {
  if (accessionNumbers.length === 0) return new Set();
  const result = await pool.query<{ accession_number: string }>(
    'SELECT accession_number FROM discovered_filings WHERE accession_number = ANY($1)',
    [accessionNumbers],
  );
  return new Set(result.rows.map((row) => row.accession_number));
}

/** Records that a filing has been enqueued. Recording one twice is harmless. */
export async function recordDiscoveredFiling(filing: {
  accessionNumber: string;
  cik: string;
  form: string;
  filingDate: string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO discovered_filings (accession_number, cik, form, filing_date) VALUES ($1, $2, $3, $4)
     ON CONFLICT (accession_number) DO NOTHING`,
    [filing.accessionNumber, filing.cik, filing.form, filing.filingDate],
  );
}

export async function startPollerRun(): Promise<number> {
  const result = await pool.query<{ id: number }>(`INSERT INTO poller_runs DEFAULT VALUES RETURNING id`);
  return result.rows[0]!.id;
}

export async function completePollerRun(runId: number, companiesChecked: number, newFilingsFound: number): Promise<void> {
  await pool.query(
    `UPDATE poller_runs
     SET status = 'completed', finished_at = now(), companies_checked = $2, new_filings_found = $3
     WHERE id = $1`,
    [runId, companiesChecked, newFilingsFound],
  );
}

export async function failPollerRun(runId: number): Promise<void> {
  await pool.query(`UPDATE poller_runs SET status = 'failed', finished_at = now() WHERE id = $1`, [runId]);
}
