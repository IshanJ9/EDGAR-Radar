import { Router } from 'express';
import { cacheKeys } from '../cache';
import { getPipelineStats } from '../repositories/statsRepository';
import { loadUniverse } from '../universe';
import { sendAndCache, sendIfCached } from './cachedResponse';

/**
 * GET /stats - the pipeline's live numbers for the frontend (post-Phase 7
 * hardening, step 3): how many companies are watched and stored, when the
 * poller and reconciliation last completed, and how many filings were found
 * in the last day. Cached for the response cache's TTL (5 minutes).
 */
const router = Router();

router.get('/', async (req, res) => {
  if (await sendIfCached(res, cacheKeys.stats)) return;
  try {
    const stats = await getPipelineStats();
    sendAndCache(res, cacheKeys.stats, { companiesMonitored: loadUniverse().length, ...stats });
  } catch (err) {
    req.log.error({ err }, 'Failed to get pipeline stats');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
