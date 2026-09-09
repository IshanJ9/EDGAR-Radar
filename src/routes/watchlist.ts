import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth';
import { CompanyFactsNotFoundError } from '../sec';
import { addToWatchlist, removeFromWatchlist, getWatchlist, DuplicateWatchlistEntryError } from '../repositories/watchlistRepository';

const router = Router();

router.use(requireAuth);

const addSchema = z.object({
  cik: z.string().regex(/^\d{1,10}$/, 'cik must be 1-10 digits'),
});

router.get('/', async (req, res) => {
  const entries = await getWatchlist(req.user!.id);
  res.json(entries);
});

router.post('/', async (req, res) => {
  const parsed = addSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const entry = await addToWatchlist(req.user!.id, parsed.data.cik);
    res.status(201).json(entry);
  } catch (err) {
    if (err instanceof DuplicateWatchlistEntryError) {
      res.status(409).json({ error: err.message });
      return;
    }
    if (err instanceof CompanyFactsNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:cik', async (req, res) => {
  const removed = await removeFromWatchlist(req.user!.id, req.params.cik);
  if (!removed) {
    res.status(404).json({ error: `CIK ${req.params.cik} is not on this user's watchlist.` });
    return;
  }
  res.status(204).send();
});

export default router;
