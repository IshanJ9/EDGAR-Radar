import { Job } from 'bullmq';
import { scoresUpdatedQueue, FilingParsedJobData } from './queues';

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
 * (not yet built) Notification Worker. No scoring happens here yet - see
 * `computeScores`.
 */
export async function processFilingParsed(job: Job<FilingParsedJobData>): Promise<void> {
  const { cik, ticker, accessionNumber, form, filingDate, primaryDocument, factsRefreshed, textIngested } = job.data;

  const scores = computeScores(cik);

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
