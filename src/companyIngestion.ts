import { upsertCompanyFacts } from './repositories/companyRepository';
import { isQuarantined, recordSuccess, recordFailure } from './repositories/failingCompanyRepository';

export type IngestionOutcome =
  | { status: 'skipped-quarantined' }
  | { status: 'success' }
  | { status: 'failed'; newlyQuarantined: boolean; error: string };

/**
 * The single entry point the backfill and poller should use to ingest a
 * company, instead of calling upsertCompanyFacts directly - this is what
 * gives every caller max-retry-then-quarantine behavior for free, the same
 * way secFetch gives every caller rate limiting and per-request retry.
 */
export async function attemptCompanyIngestion(cik: string): Promise<IngestionOutcome> {
  if (await isQuarantined(cik)) {
    return { status: 'skipped-quarantined' };
  }

  try {
    await upsertCompanyFacts(cik);
    await recordSuccess(cik);
    return { status: 'success' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const newlyQuarantined = await recordFailure(cik, message);
    return { status: 'failed', newlyQuarantined, error: message };
  }
}
