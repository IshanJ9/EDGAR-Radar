import { readFileSync } from 'fs';
import path from 'path';
import { fetchSubmissions } from './sec';
import { upsertCompanyFacts } from './repositories/companyRepository';
import { ingestMostRecentFilingText } from './repositories/filingTextRepository';
import { getLastCheckedAt, setLastCheckedAt, startPollerRun, completePollerRun, failPollerRun } from './repositories/pollerRepository';

interface UniverseEntry {
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
 */
export async function runPollCycle(): Promise<{ companiesChecked: number; newFilingsFound: number }> {
  const universe = loadUniverse();
  const since = await getLastCheckedAt();
  const cycleStartedAt = new Date();

  const runId = await startPollerRun();
  let companiesChecked = 0;
  let newFilingsFound = 0;

  try {
    for (const company of universe) {
      companiesChecked += 1;
      let submissions;
      try {
        submissions = await fetchSubmissions(company.cik);
      } catch (err) {
        console.error(`  Poller: failed to check ${company.cik} (${company.ticker}): ${err instanceof Error ? err.message : err}`);
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

      try {
        await upsertCompanyFacts(company.cik);
      } catch (err) {
        console.error(`  Poller: failed to refresh facts for ${company.cik}: ${err instanceof Error ? err.message : err}`);
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

    await setLastCheckedAt(cycleStartedAt);
    await completePollerRun(runId, companiesChecked, newFilingsFound);
    return { companiesChecked, newFilingsFound };
  } catch (err) {
    await failPollerRun(runId);
    throw err;
  }
}
