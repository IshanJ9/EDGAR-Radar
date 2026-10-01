import 'dotenv/config';
import { pool } from '../src/db';
import { computeLatestRiskFactorDiff, recomputeRiskFactorDiffFromStoredTexts, RiskFactorDiffOutcome } from '../src/riskFactorDiffService';
import { loadUniverse } from '../src/universe';

/**
 * One-off: computes and stores every universe company's latest risk-factor
 * diff (post-Phase 7 hardening, step 3, F1c). From F1c on, the parser worker
 * computes a diff when a new 10-K arrives and the API only serves stored
 * ones, so without this the site would show almost none until most
 * companies file their next 10-K in February.
 *
 * SEC cost per company: one submissions request, plus a download of each of
 * its two latest 10-Ks whose text is not stored yet. A company whose latest
 * pair is already compared costs that one request and nothing else, so a
 * re-run resumes where an interrupted one stopped. Embedding takes about
 * 10-15 s per company on the production VM.
 *
 * Run it inside the SEC budget: in production, as a one-off container of the
 * poller service (its 2/s share) with the poller stopped.
 * Usage: node dist/scripts/backfillRiskFactorDiffs.js
 *
 * `--recompute` (F1c-2) instead recomputes every company's diff from its two
 * latest STORED 10-K texts - no SEC request at all, so the poller can keep
 * running - for use after a change to how diffs are made. A diff whose Risk
 * Factors section no longer extracts is deleted.
 * Usage: node dist/scripts/backfillRiskFactorDiffs.js --recompute
 */
async function main() {
  const recompute = process.argv.includes('--recompute');
  const run = recompute ? recomputeRiskFactorDiffFromStoredTexts : computeLatestRiskFactorDiff;
  const universe = loadUniverse();
  const counts: Record<RiskFactorDiffOutcome['status'] | 'failed', number> = {
    computed: 0,
    'already-stored': 0,
    'not-enough-history': 0,
    'not-extractable': 0,
    failed: 0,
  };
  const started = Date.now();

  for (const [i, company] of universe.entries()) {
    const t0 = Date.now();
    try {
      const outcome = await run(company.cik);
      counts[outcome.status] += 1;
      const detail = outcome.status === 'not-enough-history' ? ` - ${outcome.reason}` : '';
      console.log(`  ${i + 1}/${universe.length} ${company.ticker}: ${outcome.status}${detail} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    } catch (err) {
      counts.failed += 1;
      console.error(`  ${i + 1}/${universe.length} ${company.ticker}: FAILED - ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const minutes = ((Date.now() - started) / 60000).toFixed(1);
  console.log(`${recompute ? 'Recompute' : 'Backfill'} done in ${minutes} min. ${Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(', ')}.`);
  await pool.end();
  process.exit(counts.failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
