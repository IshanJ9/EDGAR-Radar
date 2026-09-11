import { readFileSync, unlinkSync, existsSync } from 'fs';
import path from 'path';
import { downloadBulkCompanyFacts, forEachCompanyFacts } from './bulkData';
import { mostRecentFact, REVENUE_TAGS, NET_INCOME_TAGS } from './sec';
import { upsertFact, getFactsByCik } from './repositories/companyRepository';
import { startReconciliationRun, completeReconciliationRun, failReconciliationRun } from './repositories/reconciliationRepository';

interface UniverseEntry {
  cik: string;
  ticker: string;
  name: string;
}

function loadUniverse(): UniverseEntry[] {
  const universePath = path.join(__dirname, '..', 'data', 'company-universe.json');
  return JSON.parse(readFileSync(universePath, 'utf-8'));
}

const CACHE_DIR = path.join(__dirname, '..', '.cache');
const ZIP_PATH = path.join(CACHE_DIR, 'companyfacts.zip');

function factKey(tag: string, periodStart: string | null, periodEnd: string): string {
  return `${tag}|${periodStart ?? ''}|${periodEnd}`;
}

/**
 * Cross-checks our stored facts for every company in the universe against
 * SEC's independent nightly bulk companyfacts.zip - a different SEC-published
 * artifact than the per-company API the poller/backfill use, so this can
 * catch gaps a bug in the incremental path wouldn't (e.g. a company that was
 * silently skipped every poll cycle for some reason).
 */
export async function runReconciliation(): Promise<{
  companiesChecked: number;
  companiesMissingFromBulk: number;
  discrepanciesFound: number;
}> {
  const universe = loadUniverse();
  const runId = await startReconciliationRun();

  let companiesChecked = 0;
  let companiesMissingFromBulk = 0;
  let discrepanciesFound = 0;

  try {
    if (!existsSync(CACHE_DIR)) {
      const { mkdirSync } = await import('fs');
      mkdirSync(CACHE_DIR, { recursive: true });
    }

    console.log('Downloading SEC bulk companyfacts.zip (~1.4GB)...');
    await downloadBulkCompanyFacts(ZIP_PATH);
    console.log('Download complete. Processing our universe\'s entries one at a time...');

    const tickerByCik = new Map(universe.map((c) => [c.cik.padStart(10, '0'), c.ticker]));

    const { found, missing } = await forEachCompanyFacts(ZIP_PATH, universe.map((c) => c.cik), async (cik, bulkFacts) => {
      const ticker = tickerByCik.get(cik) ?? cik;

      const currentFacts = await getFactsByCik(cik);
      const currentByKey = new Map(currentFacts.map((f) => [factKey(f.tag, f.period_start, f.period_end), f.value]));

      for (const [tags] of [[REVENUE_TAGS], [NET_INCOME_TAGS]] as const) {
        const bulkFact = mostRecentFact(bulkFacts, tags);
        if (!bulkFact) continue;

        const key = factKey(bulkFact.tag, bulkFact.fact.start ?? null, bulkFact.fact.end);
        const currentValue = currentByKey.get(key);

        if (currentValue === undefined || Number(currentValue) !== bulkFact.fact.val) {
          discrepanciesFound += 1;
          console.log(
            `  Discrepancy for ${ticker} ${bulkFact.tag} [${bulkFact.fact.end}]: stored=${currentValue ?? '(missing)'}, bulk=${bulkFact.fact.val}. Reconciling...`,
          );
          await upsertFact(cik, bulkFact.tag, bulkFact.fact);
        }
      }
    });

    companiesMissingFromBulk = missing.length;
    companiesChecked = found + missing.length;
    for (const cik of missing) {
      console.warn(`  ${tickerByCik.get(cik) ?? cik} (${cik}) not found in bulk archive.`);
    }

    await completeReconciliationRun(runId, companiesChecked, companiesMissingFromBulk, discrepanciesFound);
    return { companiesChecked, companiesMissingFromBulk, discrepanciesFound };
  } catch (err) {
    await failReconciliationRun(runId);
    throw err;
  } finally {
    if (existsSync(ZIP_PATH)) {
      unlinkSync(ZIP_PATH);
    }
  }
}
