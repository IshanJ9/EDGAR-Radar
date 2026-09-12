import 'dotenv/config';
import { Worker } from 'bullmq';
import { QUEUE_NAMES } from '../src/queues';
import { processFilingDiscovered } from '../src/parserWorker';
import { createLogger } from '../src/logger';

const logger = createLogger('parser-worker');
const connection = { url: process.env.REDIS_URL! };

const worker = new Worker(QUEUE_NAMES.FILING_DISCOVERED, processFilingDiscovered, { connection });

// pino timestamps every line automatically (as a structured, machine-
// parseable field) - the manual `[${new Date().toISOString()}]` prefix this
// replaced was reinventing that by hand, baked into an otherwise
// unstructured string.
worker.on('completed', (job) => {
  logger.info({ ticker: job.data.ticker, form: job.data.form, accessionNumber: job.data.accessionNumber }, 'Processed filing.discovered job');
});

worker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, 'Job failed unexpectedly');
});

logger.info('Parser worker started, listening for filing.discovered jobs...');
