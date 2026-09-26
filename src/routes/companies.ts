import { Router } from 'express';
import { CompanyFactsNotFoundError } from '../sec';
import { pool, Queryable, readDb } from '../db';
import { CompanyRecord, getCompanyByCik, getFactsByCik, upsertCompanyFacts } from '../repositories/companyRepository';
import { getOrComputeRiskFactorDiff } from '../riskFactorDiffService';
import { cacheKeys } from '../cache';
import { sendAndCache, sendIfCached } from './cachedResponse';

const router = Router();

function isValidCik(cik: string): boolean {
  return /^\d{1,10}$/.test(cik);
}

/**
 * Returns the company if we already have it stored; otherwise fetches it
 * from SEC and stores it first (get-or-fetch), so repeat requests are served
 * from Postgres instead of re-hitting the SEC API every time.
 *
 * Phase 7, step 2 - the read replica. The common case, a company we already
 * hold, is answered by the replica. A replica miss is NOT taken to mean the
 * company is absent: replication is asynchronous, so a company stored on the
 * primary moments ago may not have arrived yet. Trusting that miss would
 * re-fetch from SEC - spending the shared SEC rate budget - and upsert data we
 * already have. So a miss is checked against the primary first.
 *
 * Also returns which database answered, so follow-up reads for the same
 * request use the same one. A company just written to (or found only on) the
 * primary must have its facts read from the primary too; the replica may hold
 * the company row without its facts yet, which would return an empty list
 * rather than an error.
 */
export async function getOrFetchCompany(cik: string): Promise<{ company: CompanyRecord | null; db: Queryable }> {
  const fromReplica = await getCompanyByCik(cik, readDb);
  if (fromReplica) return { company: fromReplica, db: readDb };

  const fromPrimary = await getCompanyByCik(cik, pool);
  if (fromPrimary) return { company: fromPrimary, db: pool };

  await upsertCompanyFacts(cik);
  return { company: await getCompanyByCik(cik, pool), db: pool };
}

router.get('/:cik', async (req, res) => {
  const { cik } = req.params;
  if (!isValidCik(cik)) {
    res.status(400).json({ error: 'CIK must be 1-10 digits' });
    return;
  }

  const key = cacheKeys.company(cik);
  if (await sendIfCached(res, key)) return;

  try {
    const { company } = await getOrFetchCompany(cik);
    sendAndCache(res, key, company);
  } catch (err) {
    if (err instanceof CompanyFactsNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    req.log.error({ err }, 'Failed to get company');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:cik/facts', async (req, res) => {
  const { cik } = req.params;
  if (!isValidCik(cik)) {
    res.status(400).json({ error: 'CIK must be 1-10 digits' });
    return;
  }

  const key = cacheKeys.facts(cik);
  if (await sendIfCached(res, key)) return;

  try {
    const { company, db } = await getOrFetchCompany(cik);
    const facts = await getFactsByCik(cik, db);
    sendAndCache(res, key, { ...company, facts });
  } catch (err) {
    if (err instanceof CompanyFactsNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    req.log.error({ err }, 'Failed to get company facts');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:cik/risk-factor-diff', async (req, res) => {
  const { cik } = req.params;
  if (!isValidCik(cik)) {
    res.status(400).json({ error: 'CIK must be 1-10 digits' });
    return;
  }

  const key = cacheKeys.riskFactorDiff(cik);
  if (await sendIfCached(res, key)) return;

  try {
    const diff = await getOrComputeRiskFactorDiff(cik);
    if (!diff) {
      res.status(404).json({ error: 'Not enough 10-K history yet to compute a risk-factor diff for this company.' });
      return;
    }
    sendAndCache(res, key, diff);
  } catch (err) {
    req.log.error({ err }, 'Failed to get risk-factor diff');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
