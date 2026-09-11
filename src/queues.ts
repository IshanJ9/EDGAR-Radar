import { Queue } from 'bullmq';

export const QUEUE_NAMES = {
  FILING_DISCOVERED: 'filing.discovered',
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

/**
 * Shared across every producer/consumer so they all talk to the same Redis
 * connection and queue name, rather than each side hardcoding the string.
 */
export const filingDiscoveredQueue = new Queue<FilingDiscoveredJobData>(QUEUE_NAMES.FILING_DISCOVERED, { connection });
