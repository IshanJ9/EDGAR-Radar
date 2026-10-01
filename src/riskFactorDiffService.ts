import { pool, readDb } from './db';
import { padCik, fetchSubmissions, findRecentFilings, SubmissionsNotFoundError } from './sec';
import { diffRiskFactorFilings } from './riskFactorDiff';
import { ingestFilingText, getFilingTextsByAccn, getLatestFilingTexts } from './repositories/filingTextRepository';
import {
  getLatestRiskFactorDiff,
  hasRiskFactorDiff,
  upsertRiskFactorDiff,
  deleteRiskFactorDiff,
  StoredRiskFactorDiff,
} from './repositories/riskFactorDiffRepository';

/**
 * The stored diff for a company, or null - all the API does (post-Phase 7
 * hardening, step 3, F1c). Diffs are computed when a 10-K arrives, by
 * `computeLatestRiskFactorDiff` below; before F1c a request for a company
 * with no stored diff downloaded two 10-Ks and embedded both, so any
 * visitor's click could spend SEC requests and 10-15 s of CPU.
 *
 * Replica first (Phase 7, step 2); a replica miss may only be replication
 * lag, so the primary is checked before answering "none".
 */
export async function getStoredRiskFactorDiff(cik: string): Promise<StoredRiskFactorDiff | null> {
  const paddedCik = padCik(cik);
  return (await getLatestRiskFactorDiff(paddedCik, readDb)) ?? (await getLatestRiskFactorDiff(paddedCik, pool));
}

export type RiskFactorDiffOutcome =
  | { status: 'computed'; currentAccn: string; priorAccn: string }
  | { status: 'already-stored'; currentAccn: string; priorAccn: string }
  | { status: 'not-enough-history'; reason: string }
  | { status: 'not-extractable'; currentAccn: string; priorAccn: string };

/**
 * Compares a company's two most recent 10-Ks and stores the result (F1c).
 * Called by the parser worker after it stores a new 10-K's text, and by the
 * one-off scripts/backfillRiskFactorDiffs.ts.
 *
 * SEC cost: one submissions request to find the two 10-Ks, plus a download
 * of each one whose text is not stored yet - none, if this pair was already
 * compared (then nothing else happens either, so a re-run is cheap and a
 * backfill resumes where it stopped). Embedding is the expensive part, about
 * 10-15 s on the production VM.
 *
 * Fewer than two 10-Ks, or a CIK SEC does not know, is `not-enough-history`;
 * a Risk Factors section that cannot be found in one of the filings is
 * `not-extractable`, and nothing is stored. Any other failure propagates.
 */
export async function computeLatestRiskFactorDiff(cik: string): Promise<RiskFactorDiffOutcome> {
  const paddedCik = padCik(cik);

  let submissions;
  try {
    submissions = await fetchSubmissions(paddedCik);
  } catch (err) {
    if (err instanceof SubmissionsNotFoundError) return { status: 'not-enough-history', reason: 'SEC has no filings for this CIK.' };
    throw err;
  }

  const filings = findRecentFilings(submissions, ['10-K'], 2); // newest first, as SEC lists them
  if (filings.length < 2) return { status: 'not-enough-history', reason: `${filings.length} 10-K on file; a comparison needs 2.` };
  const [newer, older] = filings as [(typeof filings)[0], (typeof filings)[0]];
  const pair = { currentAccn: newer.accessionNumber, priorAccn: older.accessionNumber };

  if (await hasRiskFactorDiff(paddedCik, pair.currentAccn, pair.priorAccn)) return { status: 'already-stored', ...pair };

  const alreadyStored = await getFilingTextsByAccn(paddedCik, [pair.currentAccn, pair.priorAccn]);
  for (const filing of filings) {
    if (!alreadyStored.has(filing.accessionNumber)) await ingestFilingText(paddedCik, filing);
  }

  const texts = await getFilingTextsByAccn(paddedCik, [pair.currentAccn, pair.priorAccn]);
  const result = await diffRiskFactorFilings(texts.get(pair.priorAccn)!.content, texts.get(pair.currentAccn)!.content);
  if (!result) return { status: 'not-extractable', ...pair };

  await upsertRiskFactorDiff(paddedCik, pair.currentAccn, newer.filingDate, pair.priorAccn, older.filingDate, result);
  return { status: 'computed', ...pair };
}

/**
 * Recomputes a company's diff from its two latest STORED 10-K texts - no SEC
 * request - after a change to how diffs are made (post-Phase 7 hardening,
 * step 3, F1c-2: the Risk Factors extraction fix). If the section no longer
 * extracts, the stored diff for that pair is deleted: a diff of the wrong
 * text is worse than none, and the API then answers 404 honestly.
 */
export async function recomputeRiskFactorDiffFromStoredTexts(cik: string): Promise<RiskFactorDiffOutcome> {
  const paddedCik = padCik(cik);
  const texts = await getLatestFilingTexts(paddedCik, ['10-K'], 2); // newest first
  if (texts.length < 2) return { status: 'not-enough-history', reason: `${texts.length} 10-K text stored; a comparison needs 2.` };
  const [newer, older] = texts as [(typeof texts)[0], (typeof texts)[0]];
  const pair = { currentAccn: newer.accn, priorAccn: older.accn };

  const result = await diffRiskFactorFilings(older.content, newer.content);
  if (!result) {
    await deleteRiskFactorDiff(paddedCik, pair.currentAccn, pair.priorAccn);
    return { status: 'not-extractable', ...pair };
  }
  await upsertRiskFactorDiff(paddedCik, pair.currentAccn, newer.filingDate, pair.priorAccn, older.filingDate, result);
  return { status: 'computed', ...pair };
}
