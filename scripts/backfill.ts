import 'dotenv/config';
import { readFileSync } from 'fs';
import path from 'path';
import { pool } from '../src/db';
import { upsertCompanyFacts } from '../src/repositories/companyRepository';
import { startOrResumeRun, markCompanySuccess, markCompanyFailed, completeRun, getRunSummary } from '../src/repositories/ingestionRepository';

interface UniverseEntry {
  cik: string;
  ticker: string;
  name: string;
}

async function main() {
  const universePath = path.join(__dirname, '..', 'data', 'company-universe.json');
  const universe: UniverseEntry[] = JSON.parse(readFileSync(universePath, 'utf-8'));
  const allCiks = universe.map((c) => c.cik);

  const { run, pendingCiks } = await startOrResumeRun(allCiks);

  if (pendingCiks.length < allCiks.length) {
    console.log(
      `Resuming ingestion run #${run.id}: ${allCiks.length - pendingCiks.length}/${allCiks.length} already processed, ${pendingCiks.length} remaining.`,
    );
  } else {
    console.log(`Starting new ingestion run #${run.id}: ${pendingCiks.length} companies to process.`);
  }

  let done = 0;
  for (const cik of pendingCiks) {
    try {
      await upsertCompanyFacts(cik);
      await markCompanySuccess(run.id, cik);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await markCompanyFailed(run.id, cik, message);
      console.error(`  Failed CIK ${cik}: ${message}`);
    }

    done += 1;
    if (done % 10 === 0 || done === pendingCiks.length) {
      console.log(`  Progress: ${done}/${pendingCiks.length} processed this session.`);
    }
  }

  await completeRun(run.id);
  const summary = await getRunSummary(run.id);
  console.log(
    `\nRun #${run.id} complete. Total: ${summary.total}, success: ${summary.success}, failed: ${summary.failed}, pending: ${summary.pending}.`,
  );

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
