import { Queue } from 'bullmq';

export const QUEUE_NAMES = {
  FILING_DISCOVERED: 'filing.discovered',
  FILING_PARSED: 'filing.parsed',
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
 * Shared across every producer/consumer so they all talk to the same Redis
 * connection and queue names, rather than each side hardcoding the strings.
 */
export const filingDiscoveredQueue = new Queue<FilingDiscoveredJobData>(QUEUE_NAMES.FILING_DISCOVERED, { connection });
export const filingParsedQueue = new Queue<FilingParsedJobData>(QUEUE_NAMES.FILING_PARSED, { connection });
