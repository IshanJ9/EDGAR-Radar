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

/** More than this share of a cycle's companies failing is not a few broken companies but the poller being blocked. */
export const FAILING_SHARE = 0.5;
/** Consecutive failing cycles before alerting: one bad cycle is a blip, not an outage. */
export const FAILING_CYCLES = 2;

interface FailureOptions {
  /** How an alert is delivered; injectable for tests. */
  send?: (text: string) => Promise<void>;
}

/**
 * The heartbeat's second check (post-Phase 7 hardening, step 5): a poller
 * that keeps completing cycles but cannot check most companies - SEC
 * blocking or rate-limiting the server, say - is an outage too.
 * `checkPollerHeartbeat` cannot see it: every such cycle completes, with
 * every company counted as checked. This alerts once per outage when the
 * last FAILING_CYCLES completed cycles each failed for more than
 * FAILING_SHARE of their companies; the outage began after the last healthy
 * cycle, so a later episode alerts again.
 */
export async function checkPollerFailures({ send = sendSlackAlert }: FailureOptions = {}): Promise<{ alerted: boolean; failing: boolean }> {
  const recent = await pool.query<{ finished_at: Date; companies_checked: number; companies_failed: number }>(
    `SELECT finished_at, companies_checked, companies_failed FROM poller_runs
     WHERE status = 'completed' ORDER BY finished_at DESC LIMIT ${FAILING_CYCLES}`,
  );
  const failingRun = (r: { companies_checked: number; companies_failed: number }) =>
    r.companies_checked > 0 && r.companies_failed > r.companies_checked * FAILING_SHARE;
  const failing = recent.rows.length === FAILING_CYCLES && recent.rows.every(failingRun);
  if (!failing) return { alerted: false, failing: false };

  const healthy = await pool.query<{ last_healthy: Date | null }>(
    `SELECT max(finished_at) AS last_healthy FROM poller_runs
     WHERE status = 'completed' AND companies_failed <= companies_checked * ${FAILING_SHARE}`,
  );
  const latest = recent.rows[0]!;
  const message =
    `:warning: EDGAR Radar poller is running but could not check ${latest.companies_failed} of ${latest.companies_checked} companies ` +
    `in each of its last ${FAILING_CYCLES} cycles (latest finished ${latest.finished_at.toISOString()}). ` +
    'SEC may be blocking or rate-limiting the server. No filings are lost - the cursor does not advance - but none are being found.';
  const alerted = await sendOncePerOutage('poller-failing', message, healthy.rows[0]?.last_healthy ?? null, send);
  return { alerted, failing: true };
}
