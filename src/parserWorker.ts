import { Job } from 'bullmq';
import { attemptCompanyIngestion } from './companyIngestion';
import { ingestFilingText } from './repositories/filingTextRepository';
import { filingParsedQueue, FilingDiscoveredJobData } from './queues';

// Matches the poller's pre-Phase-4 behavior: only 10-Ks are worth the
// cost of a full-text fetch + extraction for now (real Item-level
// segmentation is Phase 5's job).
const TEXT_INGEST_FORMS = ['10-K'];

/**
 * Consumes one `filing.discovered` job: refreshes the company's XBRL facts
 * (Phase 2's ingestion path, reused via `attemptCompanyIngestion` so this
 * gets max-retry-then-quarantine behavior for free) and, for a 10-K
 * specifically, ingests the filing's full text - the same two things the
 * poller used to do inline before Phase 4 decoupled detection from
 * processing. Enqueues `filing.parsed` when done so the (future) Scoring
 * Worker has something to consume.
 *
 * Known failures (a company that fails to ingest, a filing whose text
 * fails to extract) are logged and recorded via the existing quarantine
 * tracking rather than thrown - retrying via BullMQ wouldn't help, since
 * the underlying SEC call already exhausted its own retries. An unexpected
 * error (e.g. a lost DB connection) still propagates so BullMQ can retry
 * the job or eventually dead-letter it.
 */
export async function processFilingDiscovered(job: Job<FilingDiscoveredJobData>): Promise<void> {
  const { cik, ticker, accessionNumber, form, filingDate, primaryDocument } = job.data;

  const outcome = await attemptCompanyIngestion(cik);
  const factsRefreshed = outcome.status === 'success';
  if (outcome.status === 'failed') {
    console.error(
      `  Parser worker: failed to refresh facts for ${ticker} (${cik}): ${outcome.error}${outcome.newlyQuarantined ? ' (now quarantined)' : ''}`,
    );
  }

  let textIngested = false;
  if (TEXT_INGEST_FORMS.includes(form)) {
    try {
      await ingestFilingText(cik, { accessionNumber, form, filingDate, primaryDocument });
      textIngested = true;
    } catch (err) {
      console.error(
        `  Parser worker: failed to ingest filing text for ${ticker} (${cik}) accn ${accessionNumber}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  await filingParsedQueue.add('filing-parsed', {
    cik,
    ticker,
    accessionNumber,
    form,
    filingDate,
    primaryDocument,
    factsRefreshed,
    textIngested,
  });
}
