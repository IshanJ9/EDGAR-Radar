import { Job } from 'bullmq';
import { computeAltmanZDoublePrime, computePiotroskiFScore, computeBeneishMScore } from './scoring';
import { claimStage } from './repositories/stageCompletionRepository';
import { scoresUpdatedQueue, FilingParsedJobData, FilingScores } from './queues';
import { createLogger } from './logger';

const logger = createLogger('scoring-worker');
const STAGE = 'scored';

/**
 * Runs all 3 Phase 5 ratio scores (pure functions over `filing_facts`, see
 * src/scoring.ts) for a company. Each is independent and can succeed or
 * report `insufficient-history` on its own - a filing commonly has some
 * scores computed and others not (confirmed against the real 196-company
 * universe: coverage ranges from ~27% to ~73% depending on the score,
 * mostly due to real per-company differences in which XBRL tags they
 * report, not a bug). Run in parallel since they're independent read-only
 * DB queries, not sequential dependent work.
 */
async function computeScores(cik: string): Promise<FilingScores> {
  const [altmanZ, piotroskiF, beneishM] = await Promise.all([
    computeAltmanZDoublePrime(cik),
    computePiotroskiFScore(cik),
    computeBeneishMScore(cik),
  ]);
  return { altmanZ, piotroskiF, beneishM };
}

/**
 * Consumes one `filing.parsed` job, computes the real ratio scores for that
 * company against whatever's currently in `filing_facts`, and enqueues
 * `scores.updated` for the Notification Worker. Scores are recomputed on
 * every filing rather than cached - each computation is just a handful of
 * fast indexed reads plus arithmetic (no external calls), and recomputing
 * keeps results current with whatever the Parser Worker just refreshed.
 *
 * Enqueuing `scores.updated` is the only side effect here, and it's not
 * idempotent on its own, so it's guarded by `claimStage` (keyed on this
 * filing's accession number and the 'scored' stage) to prevent a
 * redelivered job from producing a duplicate downstream job.
 */
export async function processFilingParsed(job: Job<FilingParsedJobData>): Promise<void> {
  const { cik, ticker, accessionNumber, form, filingDate, primaryDocument, factsRefreshed, textIngested } = job.data;

  const scores = await computeScores(cik);
  // Structured fields (one per score, its actual numeric value or the
  // string 'n/a'), not a single flattened summary string - a log
  // aggregator can filter/query by an individual score's value this way,
  // which a pre-joined string like "altmanZ=1.685, piotroskiF=6" cannot do.
  const scoreValues = Object.fromEntries(Object.entries(scores).map(([name, outcome]) => [name, outcome.status === 'ok' ? outcome.value : 'n/a']));
  logger.info({ ticker, cik, scores: scoreValues }, 'Computed scores');

  const firstTimeAtThisStage = await claimStage(accessionNumber, STAGE);
  if (!firstTimeAtThisStage) {
    logger.info({ accessionNumber, stage: STAGE }, 'Already reached this stage - skipping duplicate enqueue');
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
