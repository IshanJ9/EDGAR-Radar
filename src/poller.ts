import { fetchSubmissions } from './sec';
import { isQuarantined, recordFailure } from './repositories/failingCompanyRepository';
import {
  getLastCheckedAt,
  setLastCheckedAt,
  startPollerRun,
  completePollerRun,
  failPollerRun,
  findDiscoveredAccessions,
  recordDiscoveredFiling,
} from './repositories/pollerRepository';
import { filingDiscoveredQueue } from './queues';
import { loadUniverse, UniverseEntry } from './universe';

export type { UniverseEntry } from './universe';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How many days before the cursor a filing's date may be and still count as
 * a candidate. SEC dates a filing in New York time while the cursor is UTC,
 * and a filing can reach SEC's submissions list some time after it was
 * accepted, so a filing can legitimately carry a date a day or more before
 * the cursor. `discovered_filings` stops the overlap from enqueueing
 * anything twice.
 */
export const FILING_LOOKBACK_DAYS = 2;

/**
 * Checks every company in the universe for filings it has not enqueued
 * before, dated no earlier than FILING_LOOKBACK_DAYS before the last
 * successful poll's cursor. Each one gets enqueued exactly once
 * as a `filing.discovered` job (one per filing) rather than processed
 * inline - as of Phase 4 that actual ingestion work (Phase 2's fact
 * upsert + full-text re-ingest) moves to a separate Parser Worker
 * consuming this queue, decoupling detection from processing.
 *
 * `universeOverride` lets tests exercise this against a small fixed set of
 * companies instead of the real ~196, so failure-simulation tests aren't
 * dominated by real per-company retry/backoff time; production callers
 * omit it and get the real universe.
 */
export async function runPollCycle(universeOverride?: UniverseEntry[]): Promise<{ companiesChecked: number; newFilingsFound: number }> {
  const universe = universeOverride ?? loadUniverse();
  const since = await getLastCheckedAt();
  const earliestFilingDate = new Date(since.getTime() - FILING_LOOKBACK_DAYS * DAY_MS).toISOString().slice(0, 10);
  const cycleStartedAt = new Date();

  const runId = await startPollerRun();
  let companiesChecked = 0;
  let newFilingsFound = 0;
  let submissionCheckFailures = 0;

  try {
    for (const company of universe) {
      companiesChecked += 1;

      if (await isQuarantined(company.cik)) {
        continue;
      }

      let submissions;
      try {
        submissions = await fetchSubmissions(company.cik);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`  Poller: failed to check ${company.cik} (${company.ticker}): ${message}`);
        submissionCheckFailures += 1;
        // Track this like any other ingestion failure so a company that is
        // *specifically* and persistently broken (not a general SEC outage)
        // eventually gets quarantined - once quarantined it's skipped before
        // reaching this fetch, so it stops blocking the cursor for everyone
        // else. A genuine outage instead fails many/all companies at once,
        // none of which individually reach the quarantine threshold from a
        // single bad cycle.
        await recordFailure(company.cik, message);
        continue;
      }

      // SEC's filingDate has no time, so it can't be compared with the cursor
      // directly: a filing made at 14:10 is dated midnight and would look
      // older than a 14:00 cursor. Instead, every filing dated within the
      // lookback window is a candidate, and the ones already enqueued are
      // dropped by accession number.
      const { recent } = submissions.filings;
      const candidateIndexes = recent.filingDate
        .map((date, idx) => ({ date, idx }))
        .filter(({ date }) => date >= earliestFilingDate)
        .map(({ idx }) => idx);
      const alreadyDiscovered = await findDiscoveredAccessions(candidateIndexes.map((idx) => recent.accessionNumber[idx]!));
      const newIndexes = candidateIndexes.filter((idx) => !alreadyDiscovered.has(recent.accessionNumber[idx]!));

      if (newIndexes.length === 0) continue;

      newFilingsFound += newIndexes.length;
      console.log(`  New filing(s) for ${company.ticker} (${company.cik}): ${newIndexes.map((i) => recent.form[i]).join(', ')}`);

      for (const idx of newIndexes) {
        const filing = {
          cik: company.cik,
          accessionNumber: recent.accessionNumber[idx]!,
          form: recent.form[idx]!,
          filingDate: recent.filingDate[idx]!,
        };
        await filingDiscoveredQueue.add('filing-discovered', {
          ...filing,
          ticker: company.ticker,
          primaryDocument: recent.primaryDocument[idx]!,
        });
        // Recorded only once it is safely on the queue: if the enqueue
        // throws, the next cycle still sees this filing as new. A crash
        // between the two lines enqueues it twice, which the parser worker
        // handles - its writes are upserts.
        await recordDiscoveredFiling(filing);
      }
    }

    // Only advance the cursor if every company was actually checked. If any
    // submissions fetch failed (e.g. a partial or full SEC outage), we don't
    // actually know whether that company filed something during this
    // window - advancing the cursor anyway would silently and permanently
    // skip it. Keeping the old cursor means the same window gets re-checked
    // for everyone next cycle, which is redundant but never loses data.
    if (submissionCheckFailures === 0) {
      await setLastCheckedAt(cycleStartedAt);
    } else {
      console.warn(
        `  Poller: ${submissionCheckFailures} company/companies could not be checked this cycle - cursor NOT advanced, same window will be re-checked next cycle.`,
      );
    }
    await completePollerRun(runId, companiesChecked, newFilingsFound);
    return { companiesChecked, newFilingsFound };
  } catch (err) {
    await failPollerRun(runId);
    throw err;
  }
}
