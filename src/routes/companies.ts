import { Router } from 'express';
import { CompanyFactsNotFoundError, padCik } from '../sec';
import { pool, Queryable, readDb } from '../db';
import { CompanyRecord, getCompanyByCik, getFactsByCik, getIndustries, upsertCompanyFacts } from '../repositories/companyRepository';
import { getStoredRiskFactorDiff } from '../riskFactorDiffService';
import { cacheKeys } from '../cache';
import { sendAndCache, sendIfCached } from './cachedResponse';
import { computeCompanyScores, summarizeScore } from '../companyScores';
import { getCompanyFinancials } from '../companyFinancials';
import { loadUniverse } from '../universe';

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

/**
 * Every monitored company with a summary of its three scores - the
 * frontend's search list and all-companies table (post-Phase 7 hardening,
 * step 3). Reads stored facts only: it never fetches from SEC.
 */
router.get('/', async (req, res) => {
  if (await sendIfCached(res, cacheKeys.companyList)) return;
  try {
    const industries = await getIndustries(readDb);
    const companies = await Promise.all(
      loadUniverse().map(async ({ cik, ticker, name }) => {
        const scores = await computeCompanyScores(cik);
        return {
          cik,
          ticker,
          name,
          industry: industries.get(cik) ?? null,
          ratings: {
            altmanZ: summarizeScore(scores.altmanZ),
            piotroskiF: summarizeScore(scores.piotroskiF),
            beneishM: summarizeScore(scores.beneishM),
          },
        };
      }),
    );
    sendAndCache(res, cacheKeys.companyList, { count: companies.length, companies });
  } catch (err) {
    req.log.error({ err }, 'Failed to list companies');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * The three scores for one company, with their inputs. A company not already
 * stored is a 404 rather than a fetch from SEC: a visitor must never be able
 * to spend the SEC rate budget.
 */
router.get('/:cik/scores', async (req, res) => {
  const { cik } = req.params;
  if (!isValidCik(cik)) {
    res.status(400).json({ error: 'CIK must be 1-10 digits' });
    return;
  }

  const key = cacheKeys.scores(cik);
  if (await sendIfCached(res, key)) return;

  try {
    const paddedCik = padCik(cik);
    const company = (await getCompanyByCik(paddedCik, readDb)) ?? (await getCompanyByCik(paddedCik, pool));
    if (!company) {
      res.status(404).json({ error: `No stored company with CIK ${paddedCik}.` });
      return;
    }
    sendAndCache(res, key, { cik: paddedCik, scores: await computeCompanyScores(paddedCik) });
  } catch (err) {
    req.log.error({ err }, 'Failed to compute scores');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Five years of a company's headline figures - revenue, profit, assets,
 * liabilities, long-term debt, operating cash flow - for the company page's
 * charts (post-Phase 7 hardening, step 3, F3). Stored facts only: a company
 * not stored is a 404, never a fetch from SEC.
 */
router.get('/:cik/financials', async (req, res) => {
  const { cik } = req.params;
  if (!isValidCik(cik)) {
    res.status(400).json({ error: 'CIK must be 1-10 digits' });
    return;
  }

  const key = cacheKeys.financials(cik);
  if (await sendIfCached(res, key)) return;

  try {
    const paddedCik = padCik(cik);
    const company = (await getCompanyByCik(paddedCik, readDb)) ?? (await getCompanyByCik(paddedCik, pool));
    if (!company) {
      res.status(404).json({ error: `No stored company with CIK ${paddedCik}.` });
      return;
    }
    sendAndCache(res, key, await getCompanyFinancials(paddedCik));
  } catch (err) {
    req.log.error({ err }, 'Failed to get financials');
    res.status(500).json({ error: 'Internal server error' });
  }
});

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
    const diff = await getStoredRiskFactorDiff(cik);
    if (!diff) {
      res.status(404).json({ error: 'No risk-factor comparison stored for this company yet. One is computed when it files a new 10-K.' });
      return;
    }
    sendAndCache(res, key, diff);
  } catch (err) {
    req.log.error({ err }, 'Failed to get risk-factor diff');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
