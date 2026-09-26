import 'dotenv/config';
import cron from 'node-cron';
import { runReconciliation } from '../src/reconciliation';
import { initResponseCache } from '../src/cache';

// Reconciliation corrects stored facts, so it must invalidate the API's
// cached responses for them (Phase 7 step 3). A no-op unless CACHE_REDIS_URL
// is set.
initResponseCache();

// 2 AM daily - a heavy job (downloads ~1.4GB), so it runs once a night, not
// on the poller's 30-minute cadence.
const SCHEDULE = '0 2 * * *';

async function runOnce() {
  console.log(`[${new Date().toISOString()}] Reconciliation run starting...`);
  try {
    const result = await runReconciliation();
    console.log(`[${new Date().toISOString()}] Reconciliation complete:`, result);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Reconciliation failed:`, err);
  }
}

// Run once at startup unless told not to. Run by hand, starting it is how you
// ask for a reconciliation, so it runs. In a container, "starting" also means
// every deploy and every restart - and each run downloads ~1.4 GB from SEC -
// so docker-compose.yml sets RECONCILE_ON_START=false and leaves it to the
// nightly schedule (post-Phase 7, step 2).
const runOnStart = process.env.RECONCILE_ON_START !== 'false';
console.log(
  `Starting EDGAR reconciliation job. Schedule: "${SCHEDULE}" (2 AM daily, container time). ${runOnStart ? 'Running an initial run now...' : 'Startup run skipped (RECONCILE_ON_START=false).'}`,
);
if (runOnStart) runOnce();
cron.schedule(SCHEDULE, runOnce);
