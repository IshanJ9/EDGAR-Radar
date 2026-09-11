import { Queue } from 'bullmq';

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
 * `scores` is `null` for now - Phase 4's Scoring Worker is deliberately a
 * stub (per ROADMAP.md, the real M-Score/Z-Score/F-Score math is Phase 5's
 * job). `null` is used rather than fabricated numbers so nothing downstream
 * can mistake a stub result for a real score.
 */
export interface ScoresUpdatedJobData extends FilingParsedJobData {
  scores: null;
}

/**
 * Shared across every producer/consumer so they all talk to the same Redis
 * connection and queue names, rather than each side hardcoding the strings.
 */
export const filingDiscoveredQueue = new Queue<FilingDiscoveredJobData>(QUEUE_NAMES.FILING_DISCOVERED, { connection });
export const filingParsedQueue = new Queue<FilingParsedJobData>(QUEUE_NAMES.FILING_PARSED, { connection });
export const scoresUpdatedQueue = new Queue<ScoresUpdatedJobData>(QUEUE_NAMES.SCORES_UPDATED, { connection });
