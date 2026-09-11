import 'dotenv/config';
import { Worker } from 'bullmq';
import { QUEUE_NAMES } from '../src/queues';
import { processFilingParsed } from '../src/scoringWorker';

const connection = { url: process.env.REDIS_URL! };

const worker = new Worker(QUEUE_NAMES.FILING_PARSED, processFilingParsed, { connection });

worker.on('completed', (job) => {
  console.log(
    `[${new Date().toISOString()}] Scoring worker: processed ${job.data.ticker} ${job.data.form} (accn ${job.data.accessionNumber}).`,
  );
});

worker.on('failed', (job, err) => {
  console.error(`[${new Date().toISOString()}] Scoring worker: job ${job?.id} failed unexpectedly:`, err);
});

console.log('Scoring worker started, listening for filing.parsed jobs...');
