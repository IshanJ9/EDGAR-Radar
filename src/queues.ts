import { Queue } from 'bullmq';
import { ScoreOutcome, AltmanZInputs, PiotroskiInputs, BeneishInputs } from './scoring';

export const QUEUE_NAMES = {
  FILING_DISCOVERED: 'filing.discovered',
  FILING_PARSED: 'filing.parsed',
  SCORES_UPDATED: 'scores.updated',
} as const;

const connection = { url: process.env.REDIS_URL! };

export interface FilingDiscoveredJobData {
  cik: string;
  ticker: string;
  accessionNumber: string;
  form: string;
  filingDate: string;
  primaryDocument: string;
}

export interface FilingParsedJobData extends FilingDiscoveredJobData {
  factsRefreshed: boolean;
  textIngested: boolean;
}

/**
 * Each score is independently either a real `{status: 'ok', value,
 * classification, inputs}` result or an honest `{status:
 * 'insufficient-history', reason}` (see src/scoring.ts) - never a
 * fabricated number. Real coverage varies a lot by company (confirmed
 * against the full 196-company universe in Phase 5 step 1), so a filing
 * can easily have some scores computed and others not.
 */
export interface FilingScores {
  altmanZ: ScoreOutcome<AltmanZInputs>;
  piotroskiF: ScoreOutcome<PiotroskiInputs>;
  beneishM: ScoreOutcome<BeneishInputs>;
}

export interface ScoresUpdatedJobData extends FilingParsedJobData {
  scores: FilingScores;
}

/**
 * Shared across every producer/consumer so they all talk to the same Redis
 * connection and queue names, rather than each side hardcoding the strings.
 */
export const filingDiscoveredQueue = new Queue<FilingDiscoveredJobData>(QUEUE_NAMES.FILING_DISCOVERED, { connection });
export const filingParsedQueue = new Queue<FilingParsedJobData>(QUEUE_NAMES.FILING_PARSED, { connection });
export const scoresUpdatedQueue = new Queue<ScoresUpdatedJobData>(QUEUE_NAMES.SCORES_UPDATED, { connection });
