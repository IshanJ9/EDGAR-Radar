import 'dotenv/config';
import { pool } from '../src/db';
import { forEachCompanyFacts } from '../src/bulkData';
import { storeCompanyFacts } from '../src/repositories/companyRepository';
import { loadUniverse } from '../src/universe';

/**
 * Re-ingests every universe company from a copy of SEC's bulk
 * companyfacts.zip already on disk (post-Phase 7 hardening, step 3, F1b-2) -
 * the same storage as scripts/backfill.ts, but with no per-company SEC
 * request. Use it after a change to what ingestion extracts (new tags, more
 * years): SEC publishes the bulk file for exactly this, and one download
 * replaces ~200 API calls.
 *
 * Usage: node dist/scripts/backfillFromBulk.js /path/to/companyfacts.zip
 * It does not download the file (src/bulkData.ts can) and never calls SEC.
 */
async function main() {
  const zipPath = process.argv[2];
  if (!zipPath) {
    console.error('Usage: backfillFromBulk <path to companyfacts.zip>');
    process.exit(1);
  }

  const ciks = loadUniverse().map((c) => c.cik);
  let stored = 0;
  const failed: string[] = [];

  const { found, missing } = await forEachCompanyFacts(zipPath, ciks, async (cik, companyFacts) => {
    try {
      await storeCompanyFacts(cik, companyFacts);
      stored += 1;
      if (stored % 20 === 0) console.log(`  Progress: ${stored}/${ciks.length} stored.`);
    } catch (err) {
      failed.push(cik);
      console.error(`  Failed CIK ${cik}: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  console.log(`Done. In the bulk file: ${found}/${ciks.length}; stored: ${stored}; failed: ${failed.length}; missing from the file: ${missing.length}.`);
  if (missing.length > 0) console.log(`  Missing: ${missing.join(', ')}`);
  await pool.end();
  process.exit(failed.length > 0 || missing.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
