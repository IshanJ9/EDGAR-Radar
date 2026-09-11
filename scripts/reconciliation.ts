import 'dotenv/config';
import cron from 'node-cron';
import { runReconciliation } from '../src/reconciliation';

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

console.log(`Starting EDGAR reconciliation job. Schedule: "${SCHEDULE}" (2 AM daily). Running an initial run now...`);
runOnce();
cron.schedule(SCHEDULE, runOnce);
