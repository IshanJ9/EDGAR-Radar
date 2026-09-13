import 'dotenv/config';
// Must stay directly after dotenv and before every other import - see
// src/bootstrap/validateApiEnv.ts.
import '../src/bootstrap/validateScoringWorkerEnv';
import { Worker } from 'bullmq';
import { QUEUE_NAMES } from '../src/queues';
import { processFilingParsed } from '../src/scoringWorker';
import { createLogger } from '../src/logger';
import { requireEnv } from '../src/config';

const logger = createLogger('scoring-worker');
const connection = { url: requireEnv('REDIS_URL') };

const worker = new Worker(QUEUE_NAMES.FILING_PARSED, processFilingParsed, { connection });

worker.on('completed', (job) => {
  logger.info({ ticker: job.data.ticker, form: job.data.form, accessionNumber: job.data.accessionNumber }, 'Processed filing.parsed job');
});

worker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, 'Job failed unexpectedly');
});

logger.info('Scoring worker started, listening for filing.parsed jobs...');
