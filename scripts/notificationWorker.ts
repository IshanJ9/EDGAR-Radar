import 'dotenv/config';
import { Worker } from 'bullmq';
import { QUEUE_NAMES } from '../src/queues';
import { processScoresUpdated } from '../src/notificationWorker';

const connection = { url: process.env.REDIS_URL! };

const worker = new Worker(QUEUE_NAMES.SCORES_UPDATED, processScoresUpdated, { connection });

worker.on('completed', (job) => {
  console.log(
    `[${new Date().toISOString()}] Notification worker: processed ${job.data.ticker} ${job.data.form} (accn ${job.data.accessionNumber}).`,
  );
});

worker.on('failed', (job, err) => {
  console.error(`[${new Date().toISOString()}] Notification worker: job ${job?.id} failed unexpectedly:`, err);
});

console.log('Notification worker started, listening for scores.updated jobs...');
