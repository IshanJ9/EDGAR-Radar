import 'dotenv/config';
import { Worker } from 'bullmq';
import { QUEUE_NAMES } from '../src/queues';
import { processScoresUpdated } from '../src/notificationWorker';
import { createLogger } from '../src/logger';

const logger = createLogger('notification-worker');
const connection = { url: process.env.REDIS_URL! };

const worker = new Worker(QUEUE_NAMES.SCORES_UPDATED, processScoresUpdated, { connection });

worker.on('completed', (job) => {
  logger.info({ ticker: job.data.ticker, form: job.data.form, accessionNumber: job.data.accessionNumber }, 'Processed scores.updated job');
});

worker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, 'Job failed unexpectedly');
});

logger.info('Notification worker started, listening for scores.updated jobs...');
