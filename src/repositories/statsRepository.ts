import { Queryable, readDb } from '../db';

/**
 * Read-only queries behind the frontend's live numbers and filings feed
 * (post-Phase 7 hardening, step 3). They read from the replica: nothing here
 * is read-after-write, and a few seconds of replication lag is invisible next
 * to a 30-minute poll.
 */

export interface PipelineStats {
  companiesStored: number;
  factsStored: number;
  filingsDiscoveredLast24h: number;
  lastPoll: { finishedAt: string; companiesChecked: number; newFilingsFound: number } | null;
  lastReconciliation: { finishedAt: string; companiesChecked: number; discrepanciesFound: number } | null;
}

export async function getPipelineStats(db: Queryable = readDb): Promise<PipelineStats> {
  const [counts, poll, reconciliation] = await Promise.all([
    db.query<{ companies: string; facts: string; filings: string }>(
      `SELECT (SELECT count(*) FROM companies) AS companies,
              (SELECT count(*) FROM filing_facts) AS facts,
              (SELECT count(*) FROM discovered_filings WHERE discovered_at > now() - interval '24 hours') AS filings`,
    ),
    db.query<{ finished_at: Date; companies_checked: number; new_filings_found: number }>(
      `SELECT finished_at, companies_checked, new_filings_found FROM poller_runs
       WHERE status = 'completed' ORDER BY finished_at DESC LIMIT 1`,
    ),
    db.query<{ finished_at: Date; companies_checked: number; discrepancies_found: number }>(
      `SELECT finished_at, companies_checked, discrepancies_found FROM reconciliation_runs
       WHERE status = 'completed' ORDER BY finished_at DESC LIMIT 1`,
    ),
  ]);
  // count(*) is a bigint, which node-postgres returns as a string.
  const row = counts.rows[0]!;
  const p = poll.rows[0];
  const r = reconciliation.rows[0];
  return {
    companiesStored: Number(row.companies),
    factsStored: Number(row.facts),
    filingsDiscoveredLast24h: Number(row.filings),
    lastPoll: p
      ? { finishedAt: p.finished_at.toISOString(), companiesChecked: p.companies_checked, newFilingsFound: p.new_filings_found }
      : null,
    lastReconciliation: r
      ? { finishedAt: r.finished_at.toISOString(), companiesChecked: r.companies_checked, discrepanciesFound: r.discrepancies_found }
      : null,
  };
}

export interface RecentFiling {
  accessionNumber: string;
  cik: string;
  form: string;
  filingDate: string;
  discoveredAt: string;
}

/** Every filing the poller discovered in the last `hours`, newest first. */
export async function getRecentFilings(hours: number, db: Queryable = readDb): Promise<RecentFiling[]> {
  const result = await db.query<{ accession_number: string; cik: string; form: string; filing_date: string; discovered_at: Date }>(
    `SELECT accession_number, cik, form, filing_date::text AS filing_date, discovered_at
     FROM discovered_filings
     WHERE discovered_at > now() - make_interval(hours => $1)
     ORDER BY discovered_at DESC, accession_number DESC`,
    [hours],
  );
  return result.rows.map((row) => ({
    accessionNumber: row.accession_number,
    cik: row.cik,
    form: row.form,
    filingDate: row.filing_date,
    discoveredAt: row.discovered_at.toISOString(),
  }));
}
