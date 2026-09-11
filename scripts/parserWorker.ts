import 'dotenv/config';
import { Worker } from 'bullmq';
import { QUEUE_NAMES } from '../src/queues';
import { processFilingDiscovered } from '../src/parserWorker';

const connection = { url: process.env.REDIS_URL! };

const worker = new Worker(QUEUE_NAMES.FILING_DISCOVERED, processFilingDiscovered, { connection });

worker.on('completed', (job) => {
  console.log(
    `[${new Date().toISOString()}] Parser worker: processed ${job.data.ticker} ${job.data.form} (accn ${job.data.accessionNumber}).`,
  );
});

worker.on('failed', (job, err) => {
  console.error(`[${new Date().toISOString()}] Parser worker: job ${job?.id} failed unexpectedly:`, err);
});

console.log('Parser worker started, listening for filing.discovered jobs...');
