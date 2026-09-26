import { pool, readDb } from './db';
import { padCik, SubmissionsNotFoundError } from './sec';
import { diffRiskFactorFilings } from './riskFactorDiff';
import { ingestRecentFilingsText, getRecentFilingTexts, NoFilingFoundError } from './repositories/filingTextRepository';
import { getLatestRiskFactorDiff, upsertRiskFactorDiff, StoredRiskFactorDiff } from './repositories/riskFactorDiffRepository';

/**
 * Get-or-compute, same pattern as `getOrFetchCompany` in the companies
 * route: serves a cached diff if one exists, otherwise ingests whatever
 * 10-K text is missing, computes the diff (the expensive part - embedding
 * every chunk locally), stores it, and returns it. Returns `null` if the
 * company doesn't have 2 fiscal years of 10-K history yet, or if the Risk
 * Factors section couldn't be extracted from one/both filings - the same
 * honest "not enough history" shape used by the ratio scores in step 3,
 * rather than a crash or a misleading empty result.
 */
export async function getOrComputeRiskFactorDiff(cik: string): Promise<StoredRiskFactorDiff | null> {
  const paddedCik = padCik(cik);

  // Replica first (Phase 7, step 2). A replica miss may only be replication
  // lag, and recomputing is the most expensive thing the API does - it embeds
  // every chunk of two 10-Ks - so the primary is checked before recomputing,
  // for the same reason getOrFetchCompany does before re-fetching from SEC.
  const cached = (await getLatestRiskFactorDiff(paddedCik, readDb)) ?? (await getLatestRiskFactorDiff(paddedCik, pool));
  if (cached) return cached;

  try {
    await ingestRecentFilingsText(paddedCik, ['10-K'], 2);
  } catch (err) {
    if (err instanceof NoFilingFoundError || err instanceof SubmissionsNotFoundError) return null;
    throw err;
  }

  const texts = await getRecentFilingTexts(paddedCik, ['10-K'], 2);
  if (texts.length < 2) return null;

  const [newer, older] = texts; // getRecentFilingTexts orders newest first
  const result = await diffRiskFactorFilings(older!.content, newer!.content);
  if (!result) return null;

  await upsertRiskFactorDiff(paddedCik, newer!.accn, newer!.filingDate, older!.accn, older!.filingDate, result);

  return {
    cik: paddedCik,
    currentAccn: newer!.accn,
    currentFilingDate: newer!.filingDate,
    priorAccn: older!.accn,
    priorFilingDate: older!.filingDate,
    summary: result.summary,
    chunks: result.chunks,
    computedAt: new Date().toISOString(),
  };
}
