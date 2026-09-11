import { Job } from 'bullmq';
import { claimStage } from './repositories/stageCompletionRepository';
import { scoresUpdatedQueue, FilingParsedJobData } from './queues';

const STAGE = 'scored';

/**
 * Placeholder for Phase 5's real scoring math (Beneish M-Score, Altman
 * Z-Score, Piotroski F-Score, computed as pure functions over
 * `filing_facts`, per ROADMAP.md). Phase 4's goal is purely architectural -
 * proving a fourth independently-scalable stage exists and passes work
 * along correctly - so this deliberately does nothing yet rather than
 * fabricating scores that would look real downstream.
 */
function computeScores(_cik: string): null {
  return null;
}

/**
 * Consumes one `filing.parsed` job and enqueues `scores.updated` for the
 * Notification Worker. No scoring happens here yet - see `computeScores`.
 *
 * Enqueuing `scores.updated` is the only side effect here, and it's not
 * idempotent on its own, so it's guarded by `claimStage` (keyed on this
 * filing's accession number and the 'scored' stage) to prevent a
 * redelivered job from producing a duplicate downstream job.
 */
export async function processFilingParsed(job: Job<FilingParsedJobData>): Promise<void> {
  const { cik, ticker, accessionNumber, form, filingDate, primaryDocument, factsRefreshed, textIngested } = job.data;

  const scores = computeScores(cik);

  const firstTimeAtThisStage = await claimStage(accessionNumber, STAGE);
  if (!firstTimeAtThisStage) {
    console.log(`  Scoring worker: accn ${accessionNumber} already reached the '${STAGE}' stage - skipping duplicate scores.updated enqueue.`);
    return;
  }

  await scoresUpdatedQueue.add('scores-updated', {
    cik,
    ticker,
    accessionNumber,
    form,
    filingDate,
    primaryDocument,
    factsRefreshed,
    textIngested,
    scores,
  });
}
