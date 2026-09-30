import { Router } from 'express';
import { cacheKeys } from '../cache';
import { readDb } from '../db';
import { categorizeForm, FILING_CATEGORIES, FilingCategory } from '../filingCategories';
import { getRecentFilings } from '../repositories/statsRepository';
import { loadUniverse } from '../universe';
import { sendAndCache, sendIfCached } from './cachedResponse';

/**
 * GET /filings/recent - the frontend's live feed (post-Phase 7 hardening,
 * step 3): every filing the poller discovered in the last `hours` (default
 * 24, at most a week), newest first, each with its company and a plain
 * category.
 *
 * `exclude` (comma-separated categories) drops routine paperwork from the
 * list - e.g. `exclude=offering` folds away banks' bond prospectuses, 618 of
 * 662 filings on 2026-09-30. `total` and `countsByCategory` still cover
 * everything, so the page can say what it folded away.
 */
const router = Router();

const MAX_HOURS = 168;
const MAX_FILINGS = 200;

router.get('/recent', async (req, res) => {
  const hoursParam = typeof req.query.hours === 'string' ? req.query.hours : '24';
  const hours = /^\d+$/.test(hoursParam) ? Number(hoursParam) : NaN;
  if (!(hours >= 1 && hours <= MAX_HOURS)) {
    res.status(400).json({ error: `hours must be a whole number from 1 to ${MAX_HOURS}` });
    return;
  }

  const excludeParam = typeof req.query.exclude === 'string' ? req.query.exclude : '';
  const exclude = [...new Set(excludeParam.split(',').filter(Boolean))].sort();
  const unknown = exclude.filter((c) => !FILING_CATEGORIES.includes(c as FilingCategory));
  if (unknown.length > 0) {
    // Validated, not ignored: every distinct value would otherwise be its own cache entry.
    res.status(400).json({ error: `Unknown categories: ${unknown.join(', ')}. Known: ${FILING_CATEGORIES.join(', ')}` });
    return;
  }

  const key = cacheKeys.recentFilings(hours, exclude);
  if (await sendIfCached(res, key)) return;

  try {
    const companies = new Map(loadUniverse().map((c) => [c.cik, c]));
    const all = (await getRecentFilings(hours, readDb)).map((filing) => ({
      ...filing,
      ticker: companies.get(filing.cik)?.ticker ?? null,
      name: companies.get(filing.cik)?.name ?? null,
      category: categorizeForm(filing.form),
    }));

    const countsByCategory: Partial<Record<FilingCategory, number>> = {};
    for (const f of all) countsByCategory[f.category] = (countsByCategory[f.category] ?? 0) + 1;

    const filings = all.filter((f) => !exclude.includes(f.category)).slice(0, MAX_FILINGS);
    sendAndCache(res, key, { windowHours: hours, total: all.length, countsByCategory, filings });
  } catch (err) {
    req.log.error({ err }, 'Failed to list recent filings');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
