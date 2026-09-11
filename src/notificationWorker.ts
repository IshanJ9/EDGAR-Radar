import { Job } from 'bullmq';
import { getWatchersForCik } from './repositories/watchlistRepository';
import { claimStage } from './repositories/stageCompletionRepository';
import { sendSlackAlert } from './alerting';
import { ScoresUpdatedJobData } from './queues';

const STAGE = 'notified';

/**
 * Consumes one `scores.updated` job: checks who's watching this company and
 * alerts (via the same Slack-webhook-or-console-fallback used by Phase 3's
 * heartbeat alerting) only if someone actually is. `scores` is still the
 * Phase 4 stub (`null`) - this notifies "a new filing was processed for a
 * company you're watching," not a risk-score alert, since no real score
 * exists yet to alert on (that's Phase 5).
 *
 * Sending the alert is this worker's only side effect, and unlike the
 * earlier stages there's no upsert to fall back on - a duplicate send would
 * mean a duplicate message landing in Slack (or a duplicate console line).
 * Guarded by `claimStage` (keyed on this filing's accession number and the
 * 'notified' stage) so a redelivered job can't double-alert.
 */
export async function processScoresUpdated(job: Job<ScoresUpdatedJobData>): Promise<void> {
  const { cik, ticker, form, accessionNumber, filingDate } = job.data;

  const watchers = await getWatchersForCik(cik);
  if (watchers.length === 0) {
    return;
  }

  const firstTimeAtThisStage = await claimStage(accessionNumber, STAGE);
  if (!firstTimeAtThisStage) {
    console.log(`  Notification worker: accn ${accessionNumber} already reached the '${STAGE}' stage - skipping duplicate alert.`);
    return;
  }

  const message = `:bell: New ${form} filed for ${ticker} (${filingDate}, accn ${accessionNumber}) - watched by ${watchers.length} user(s): ${watchers
    .map((w) => w.email)
    .join(', ')}`;
  await sendSlackAlert(message);
}
