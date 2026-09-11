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

async function runOnce() {
  const { alerted, lastSuccessAt } = await checkPollerHeartbeat(THRESHOLD_MINUTES);
  console.log(
    `[${new Date().toISOString()}] Heartbeat check: last poller success ${lastSuccessAt ? lastSuccessAt.toISOString() : 'never'}.${alerted ? ' Alert sent.' : ''}`,
  );
}

console.log(`Starting heartbeat monitor. Schedule: "${SCHEDULE}" (every 15 min), threshold: ${THRESHOLD_MINUTES} min. Running an initial check now...`);
runOnce();
cron.schedule(SCHEDULE, runOnce);
