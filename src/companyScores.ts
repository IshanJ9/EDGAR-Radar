import { computeAltmanZDoublePrime, computeBeneishMScore, computePiotroskiFScore } from './scoring';

/**
 * The three Phase 5 scores for one company, for the frontend (post-Phase 7
 * hardening, step 3). Computed from stored facts on request - scoring all 196
 * companies took 1.5 s on the production VM - and cached like any response.
 */
export async function computeCompanyScores(cik: string) {
  const [altmanZ, piotroskiF, beneishM] = await Promise.all([
    computeAltmanZDoublePrime(cik),
    computePiotroskiFScore(cik),
    computeBeneishMScore(cik),
  ]);
  return { altmanZ, piotroskiF, beneishM };
}

type Outcome = Awaited<ReturnType<typeof computeCompanyScores>>[keyof Awaited<ReturnType<typeof computeCompanyScores>>];

export type RatingSummary = { status: 'ok'; value: number; classification: string } | { status: 'insufficient-history' };

/** A score without its inputs or reason: enough for a list, a fraction of the size. */
export function summarizeScore(outcome: Outcome): RatingSummary {
  return outcome.status === 'ok'
    ? { status: 'ok', value: outcome.value, classification: outcome.classification }
    : { status: 'insufficient-history' };
}
