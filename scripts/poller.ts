import 'dotenv/config';
import cron from 'node-cron';
import { runPollCycle } from '../src/poller';

// Every 30 minutes - EDGAR filings don't arrive frequently enough to justify
// anything tighter, and this checks all ~196 companies' submissions each run.
const SCHEDULE = '*/30 * * * *';

async function runOnce() {
  console.log(`[${new Date().toISOString()}] Poll cycle starting...`);
  try {
    const { companiesChecked, newFilingsFound } = await runPollCycle();
    console.log(
      `[${new Date().toISOString()}] Poll cycle complete: ${companiesChecked} companies checked, ${newFilingsFound} new filing(s) found.`,
    );
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Poll cycle failed:`, err);
  }
}

console.log(`Starting EDGAR poller. Schedule: "${SCHEDULE}" (every 30 minutes). Running an initial cycle now...`);
runOnce();
cron.schedule(SCHEDULE, runOnce);
