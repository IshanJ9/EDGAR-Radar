import { readFileSync } from 'fs';
import path from 'path';
import { fetchSubmissions } from './sec';
import { attemptCompanyIngestion } from './companyIngestion';
import { isQuarantined, recordFailure } from './repositories/failingCompanyRepository';
import { ingestMostRecentFilingText } from './repositories/filingTextRepository';
import { getLastCheckedAt, setLastCheckedAt, startPollerRun, completePollerRun, failPollerRun } from './repositories/pollerRepository';

export interface UniverseEntry {
  cik: string;
  ticker: string;
  name: string;
}

function loadUniverse(): UniverseEntry[] {
  const universePath = path.join(__dirname, '..', 'data', 'company-universe.json');
  return JSON.parse(readFileSync(universePath, 'utf-8'));
}

/**
 * Checks every company in the universe for filings newer than the last
 * successful poll's cursor. Any company with a new filing gets its
 * XBRL facts re-upserted (cheap, idempotent, and companyfacts aggregates
 * all of a company's data regardless of which specific filing changed it);
 * a new 10-K specifically also triggers a full-text re-ingest.
 *
 * `universeOverride` lets tests exercise this against a small fixed set of
 * companies instead of the real ~196, so failure-simulation tests aren't
 * dominated by real per-company retry/backoff time; production callers
 * omit it and get the real universe.
 */
export async function runPollCycle(universeOverride?: UniverseEntry[]): Promise<{ companiesChecked: number; newFilingsFound: number }> {
  const universe = universeOverride ?? loadUniverse();
  const since = await getLastCheckedAt();
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

      const { recent } = submissions.filings;
      const newIndexes = recent.filingDate
        .map((date, idx) => ({ date, idx }))
        .filter(({ date }) => new Date(date) > since)
        .map(({ idx }) => idx);

      if (newIndexes.length === 0) continue;

      newFilingsFound += newIndexes.length;
      console.log(`  New filing(s) for ${company.ticker} (${company.cik}): ${newIndexes.map((i) => recent.form[i]).join(', ')}`);

      const outcome = await attemptCompanyIngestion(company.cik);
      if (outcome.status === 'failed') {
        console.error(`  Poller: failed to refresh facts for ${company.cik}: ${outcome.error}${outcome.newlyQuarantined ? ' (now quarantined)' : ''}`);
      }

      const hasNew10K = newIndexes.some((i) => recent.form[i] === '10-K');
      if (hasNew10K) {
        try {
          await ingestMostRecentFilingText(company.cik, ['10-K']);
        } catch (err) {
          console.error(`  Poller: failed to refresh filing text for ${company.cik}: ${err instanceof Error ? err.message : err}`);
        }
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
