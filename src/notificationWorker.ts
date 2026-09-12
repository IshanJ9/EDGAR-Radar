import { Job } from 'bullmq';
import { getWatchersForCik } from './repositories/watchlistRepository';
import { claimStage } from './repositories/stageCompletionRepository';
import { sendSlackAlert } from './alerting';
import { ScoresUpdatedJobData, FilingScores } from './queues';
import { ScoreOutcome } from './scoring';
import { createLogger } from './logger';

const logger = createLogger('notification-worker');
const STAGE = 'notified';

/**
 * Phase 5's "not enough history yet" fallback: real ratio-score coverage
 * varies a lot by company (confirmed against the full 196-company universe
 * in step 1 - anywhere from ~27% to ~73% depending on the score, mostly
 * because companies genuinely differ in which XBRL tags they report, not a
 * bug). This is the one place a human currently sees these results, so a
 * missing score has to read as a clean, honest "not enough history yet"
 * rather than a raw internal status object, a blank line, or - worse -
 * something that reads as a real zero/negative score.
 */
function formatScoreLine(name: string, outcome: ScoreOutcome<unknown>): string {
  if (outcome.status === 'ok') {
    return `${name}: ${outcome.value} (${outcome.classification})`;
  }
  return `${name}: not enough history yet`;
}

function formatScores(scores: FilingScores): string {
  return [
    formatScoreLine('Altman Z"', scores.altmanZ),
    formatScoreLine('Piotroski F', scores.piotroskiF),
    formatScoreLine('Beneish M', scores.beneishM),
  ].join(' | ');
}

/**
 * Consumes one `scores.updated` job: checks who's watching this company and
 * alerts (via the same Slack-webhook-or-console-fallback used by Phase 3's
 * heartbeat alerting) only if someone actually is, including the real
 * ratio-score results computed by the Scoring Worker.
 *
 * Sending the alert is this worker's only side effect, and unlike the
 * earlier stages there's no upsert to fall back on - a duplicate send would
 * mean a duplicate message landing in Slack (or a duplicate console line).
 * Guarded by `claimStage` (keyed on this filing's accession number and the
 * 'notified' stage) so a redelivered job can't double-alert.
 */
export async function processScoresUpdated(job: Job<ScoresUpdatedJobData>): Promise<void> {
  const { cik, ticker, form, accessionNumber, filingDate, scores } = job.data;

  const watchers = await getWatchersForCik(cik);
  if (watchers.length === 0) {
    return;
  }

  const firstTimeAtThisStage = await claimStage(accessionNumber, STAGE);
  if (!firstTimeAtThisStage) {
    logger.info({ accessionNumber, stage: STAGE }, 'Already reached this stage - skipping duplicate alert');
    return;
  }

  const message = `:bell: New ${form} filed for ${ticker} (${filingDate}, accn ${accessionNumber}) - watched by ${watchers.length} user(s): ${watchers
    .map((w) => w.email)
    .join(', ')}\nScores - ${formatScores(scores)}`;
  await sendSlackAlert(message);
}
