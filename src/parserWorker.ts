import { Job } from 'bullmq';
import { attemptCompanyIngestion } from './companyIngestion';
import { carriesFinancialStatements } from './filingCategories';
import { ingestFilingText } from './repositories/filingTextRepository';
import { claimStage } from './repositories/stageCompletionRepository';
import { computeLatestRiskFactorDiff } from './riskFactorDiffService';
import { filingParsedQueue, FilingDiscoveredJobData } from './queues';
import { createLogger } from './logger';

const logger = createLogger('parser-worker');

// Matches the poller's pre-Phase-4 behavior: only 10-Ks are worth the
// cost of a full-text fetch + extraction for now (real Item-level
// segmentation is Phase 5's job).
const TEXT_INGEST_FORMS = ['10-K'];

const STAGE = 'parsed';

/**
 * Consumes one `filing.discovered` job: for an annual or quarterly report,
 * refreshes the company's XBRL facts (Phase 2's ingestion path, reused via
 * `attemptCompanyIngestion` so this gets max-retry-then-quarantine behavior
 * for free; other forms skip it since post-Phase 7 hardening, step 4) and, for a 10-K
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
 *
 * The fact/text upserts above are already naturally idempotent (safe to
 * redo on a redelivered job), but enqueuing `filing.parsed` is not - so
 * that specific step is guarded by `claimStage`, keyed on this filing's
 * accession number and the 'parsed' stage, so a redelivered job can't
 * produce a duplicate downstream job.
 */
export async function processFilingDiscovered(job: Job<FilingDiscoveredJobData>): Promise<void> {
  const { cik, ticker, accessionNumber, form, filingDate, primaryDocument } = job.data;

  // Only a filing that can change the financial statements refreshes them
  // (post-Phase 7 hardening, step 4). Every other filing - most of them bond
  // prospectuses - used to download the company's whole companyfacts
  // document for nothing. Anything missed is still caught by the nightly
  // reconciliation against SEC's bulk file.
  const outcome = carriesFinancialStatements(form) ? await attemptCompanyIngestion(cik) : null;
  const factsRefreshed = outcome?.status === 'success';
  if (outcome === null) {
    logger.info({ ticker, cik, accessionNumber, form }, 'No financial statements in this form - facts not refreshed');
  } else if (outcome.status === 'failed') {
    // outcome.error is a plain string (see companyIngestion.ts's Outcome
    // type), not an Error instance - kept under `reason`, not `err`, so it
    // isn't misread as something pino's Error serializer should apply to.
    logger.error({ ticker, cik, reason: outcome.error, newlyQuarantined: outcome.newlyQuarantined }, 'Failed to refresh company facts');
  }

  let textIngested = false;
  if (TEXT_INGEST_FORMS.includes(form)) {
    try {
      await ingestFilingText(cik, { accessionNumber, form, filingDate, primaryDocument });
      textIngested = true;
    } catch (err) {
      logger.error({ ticker, cik, accessionNumber, err }, 'Failed to ingest filing text');
    }
  }

  // A new 10-K is the only time a company's risk-factor diff can change, so
  // it is computed here rather than on an API request (post-Phase 7
  // hardening, step 3, F1c). Logged, not thrown, like a failed text ingest:
  // the filing's facts and scores matter more than the diff, and the next
  // 10-K - or a backfill re-run - computes it.
  if (textIngested) {
    try {
      const outcome = await computeLatestRiskFactorDiff(cik);
      logger.info({ ticker, cik, accessionNumber, outcome }, 'Risk-factor diff');
    } catch (err) {
      logger.error({ ticker, cik, accessionNumber, err }, 'Failed to compute risk-factor diff');
    }
  }

  const firstTimeAtThisStage = await claimStage(accessionNumber, STAGE);
  if (!firstTimeAtThisStage) {
    logger.info({ accessionNumber, stage: STAGE }, 'Already reached this stage - skipping duplicate enqueue');
    return;
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
