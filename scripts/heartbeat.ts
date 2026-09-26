import 'dotenv/config';
import cron from 'node-cron';
import { checkPollerHeartbeat } from '../src/alerting';

// Checks every 15 minutes; alerts if the poller (which itself runs every 30
// minutes) hasn't completed successfully in 60 minutes - allowing for one
// missed cycle before raising an alert, to avoid false alarms on a single
// slow run.
const SCHEDULE = '*/15 * * * *';
const THRESHOLD_MINUTES = process.env.ALERT_HEARTBEAT_THRESHOLD_MINUTES
  ? Number(process.env.ALERT_HEARTBEAT_THRESHOLD_MINUTES)
  : 60;

// Silence is measured from here until the poller's first success, so a fresh
// deploy gets the full threshold before a "no cycle yet" alert (post-Phase 7,
// step 4).
const STARTED_AT = new Date();

async function runOnce() {
  const { alerted, lastSuccessAt } = await checkPollerHeartbeat(THRESHOLD_MINUTES, { monitoringSince: STARTED_AT });
  console.log(
    `[${new Date().toISOString()}] Heartbeat check: last poller success ${lastSuccessAt ? lastSuccessAt.toISOString() : 'never'}.${alerted ? ' Alert sent.' : ''}`,
  );
}

console.log(`Starting heartbeat monitor. Schedule: "${SCHEDULE}" (every 15 min), threshold: ${THRESHOLD_MINUTES} min. Running an initial check now...`);
runOnce();
cron.schedule(SCHEDULE, runOnce);
