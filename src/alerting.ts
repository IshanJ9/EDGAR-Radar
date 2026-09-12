import { pool } from './db';
import { createLogger } from './logger';

// Tagged 'alerting' (the module), not a specific service name - this file
// is shared by both the composed notification worker (sendSlackAlert) and
// the non-composed scripts/heartbeat.ts (checkPollerHeartbeat), so hardcoding
// either caller's name here would misattribute the other's log lines.
const logger = createLogger('alerting');

/**
 * Posts a message to the configured Slack incoming webhook. If none is
 * configured (ALERT_SLACK_WEBHOOK_URL unset), logs a clear warning instead
 * of silently doing nothing - the alert condition itself still needs to be
 * visible even before a real webhook is wired up.
 */
export async function sendSlackAlert(text: string): Promise<void> {
  const webhookUrl = process.env.ALERT_SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    logger.warn({ text }, 'No Slack webhook configured - would have sent this alert');
    return;
  }

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    logger.error({ status: response.status, body: await response.text() }, 'Failed to send Slack alert');
  }
}

/**
 * Throttles repeat alerts of the same kind: only sends if we haven't already
 * alerted for this `alertType` within `throttleMinutes`, so a prolonged
 * outage doesn't spam a new message every time the heartbeat check runs.
 */
async function sendThrottledAlert(alertType: string, text: string, throttleMinutes: number): Promise<boolean> {
  const existing = await pool.query<{ last_alerted_at: Date }>(
    'SELECT last_alerted_at FROM alert_state WHERE alert_type = $1',
    [alertType],
  );
  const lastAlertedAt = existing.rows[0]?.last_alerted_at;
  const throttled = lastAlertedAt && Date.now() - lastAlertedAt.getTime() < throttleMinutes * 60_000;
  if (throttled) return false;

  await sendSlackAlert(text);
  await pool.query(
    `INSERT INTO alert_state (alert_type, last_alerted_at) VALUES ($1, now())
     ON CONFLICT (alert_type) DO UPDATE SET last_alerted_at = now()`,
    [alertType],
  );
  return true;
}

/**
 * Checks whether the poller has completed successfully within
 * `thresholdMinutes`. This must be driven by a source outside the poller
 * itself (a separate cron job checking the database) - if the poller
 * process crashed entirely, nothing inside it would be left to notice.
 */
export async function checkPollerHeartbeat(thresholdMinutes: number): Promise<{ alerted: boolean; lastSuccessAt: Date | null }> {
  const result = await pool.query<{ finished_at: Date }>(
    `SELECT finished_at FROM poller_runs WHERE status = 'completed' ORDER BY finished_at DESC LIMIT 1`,
  );
  const lastSuccessAt = result.rows[0]?.finished_at ?? null;
  const minutesSinceSuccess = lastSuccessAt ? (Date.now() - lastSuccessAt.getTime()) / 60_000 : Infinity;

  if (minutesSinceSuccess <= thresholdMinutes) {
    return { alerted: false, lastSuccessAt };
  }

  const message = lastSuccessAt
    ? `EDGAR Radar poller has not completed successfully in over ${thresholdMinutes} minutes (last success: ${lastSuccessAt.toISOString()}).`
    : `EDGAR Radar poller has never completed successfully.`;

  const alerted = await sendThrottledAlert('poller-silence', `:warning: ${message}`, thresholdMinutes);
  return { alerted, lastSuccessAt };
}
