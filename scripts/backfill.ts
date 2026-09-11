import 'dotenv/config';
import { readFileSync } from 'fs';
import path from 'path';
import { pool } from '../src/db';
import { attemptCompanyIngestion } from '../src/companyIngestion';
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
    const outcome = await attemptCompanyIngestion(cik);
    if (outcome.status === 'success') {
      await markCompanySuccess(run.id, cik);
    } else if (outcome.status === 'skipped-quarantined') {
      await markCompanyFailed(run.id, cik, 'Skipped: quarantined after repeated failures (see failing_companies)');
      console.error(`  Skipped CIK ${cik}: quarantined after repeated failures.`);
    } else {
      await markCompanyFailed(run.id, cik, outcome.error);
      console.error(`  Failed CIK ${cik}: ${outcome.error}${outcome.newlyQuarantined ? ' (now quarantined)' : ''}`);
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
