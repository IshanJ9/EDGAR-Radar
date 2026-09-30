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

  // Throw, don't just log: the heartbeat records an alert as sent only after
  // this returns, so a rejected delivery must fail loudly to be retried at
  // the next check. The message names the status, never the webhook URL,
  // which is a secret.
  if (!response.ok) {
    const body = await response.text();
    logger.error({ status: response.status, body }, 'Failed to send Slack alert');
    throw new Error(`Slack rejected the alert: HTTP ${response.status}`);
  }
}

/**
 * Sends `text` unless an alert of this `alertType` has already been sent
 * since `outageStartedAfter` - i.e. once per outage, however long it lasts.
 *
 * Why this replaced a time-based throttle (post-Phase 7, step 4): the old
 * rule suppressed repeats only for `throttleMinutes` after the previous alert,
 * and was called with the heartbeat's own 60-minute threshold - so a long
 * outage re-alerted about every 75 minutes. Phase 3's real 48h run proved it:
 * one 3.5-day poller outage produced 68 alerts (see PROGRESS.md).
 *
 * The rule needs no extra state beyond `alert_state.last_alerted_at`: an alert
 * is always sent after the outage it reports began, so if the last alert is
 * newer than the last success, this outage has already been reported. A new
 * success moves `outageStartedAfter` past that alert, re-arming it for the
 * next outage. With no success ever (`null`), any earlier alert counts.
 */
async function sendOncePerOutage(
  alertType: string,
  text: string,
  outageStartedAfter: Date | null,
  send: (text: string) => Promise<void>,
): Promise<boolean> {
  const existing = await pool.query<{ last_alerted_at: Date }>(
    'SELECT last_alerted_at FROM alert_state WHERE alert_type = $1',
    [alertType],
  );
  const lastAlertedAt = existing.rows[0]?.last_alerted_at;
  const alreadyReported = lastAlertedAt !== undefined && (outageStartedAfter === null || lastAlertedAt > outageStartedAfter);
  if (alreadyReported) return false;

  await send(text);
  await pool.query(
    `INSERT INTO alert_state (alert_type, last_alerted_at) VALUES ($1, now())
     ON CONFLICT (alert_type) DO UPDATE SET last_alerted_at = now()`,
    [alertType],
  );
  return true;
}

export interface HeartbeatOptions {
  /** Injectable clock, for tests. */
  now?: () => Date;
  /**
   * When monitoring began - normally the heartbeat process's own start. With
   * no successful poll yet, silence is measured from here rather than treated
   * as infinite. Without this, a fresh deploy alerted "never completed" on its
   * very first check, seconds before the poller's first cycle could finish
   * (observed in post-Phase 7 step 2: 9 seconds early).
   */
  monitoringSince?: Date;
  /** How an alert is delivered; injectable for tests. */
  send?: (text: string) => Promise<void>;
}

/**
 * Checks whether the poller has completed successfully within
 * `thresholdMinutes`, and alerts once per outage if not. This must be driven
 * by a source outside the poller itself (a separate process checking the
 * database) - if the poller process crashed entirely, nothing inside it would
 * be left to notice.
 */
export async function checkPollerHeartbeat(
  thresholdMinutes: number,
  { now = () => new Date(), monitoringSince, send = sendSlackAlert }: HeartbeatOptions = {},
): Promise<{ alerted: boolean; lastSuccessAt: Date | null }> {
  const result = await pool.query<{ finished_at: Date }>(
    `SELECT finished_at FROM poller_runs WHERE status = 'completed' ORDER BY finished_at DESC LIMIT 1`,
  );
  const lastSuccessAt = result.rows[0]?.finished_at ?? null;
  const silentSince = lastSuccessAt ?? monitoringSince ?? null;
  const minutesSilent = silentSince ? (now().getTime() - silentSince.getTime()) / 60_000 : Infinity;

  if (minutesSilent <= thresholdMinutes) {
    return { alerted: false, lastSuccessAt };
  }

  const message = lastSuccessAt
    ? `EDGAR Radar poller has not completed successfully in over ${thresholdMinutes} minutes (last success: ${lastSuccessAt.toISOString()}).`
    : `EDGAR Radar poller has not completed a single cycle in the ${thresholdMinutes} minutes since monitoring began.`;

  const alerted = await sendOncePerOutage('poller-silence', `:warning: ${message}`, lastSuccessAt, send);
  return { alerted, lastSuccessAt };
}
