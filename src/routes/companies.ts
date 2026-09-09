import { Router } from 'express';
import { CompanyFactsNotFoundError } from '../sec';
import { getCompanyByCik, getFactsByCik, upsertCompanyFacts } from '../repositories/companyRepository';

const router = Router();

function isValidCik(cik: string): boolean {
  return /^\d{1,10}$/.test(cik);
}

// Returns the company if we already have it stored; otherwise fetches it
// from SEC and stores it first (get-or-fetch), so repeat requests are served
// from Postgres instead of re-hitting the SEC API every time.
async function getOrFetchCompany(cik: string) {
  const existing = await getCompanyByCik(cik);
  if (existing) return existing;

  await upsertCompanyFacts(cik);
  return getCompanyByCik(cik);
}

router.get('/:cik', async (req, res) => {
  const { cik } = req.params;
  if (!isValidCik(cik)) {
    res.status(400).json({ error: 'CIK must be 1-10 digits' });
    return;
  }

  try {
    const company = await getOrFetchCompany(cik);
    res.json(company);
  } catch (err) {
    if (err instanceof CompanyFactsNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:cik/facts', async (req, res) => {
  const { cik } = req.params;
  if (!isValidCik(cik)) {
    res.status(400).json({ error: 'CIK must be 1-10 digits' });
    return;
  }

  try {
    const company = await getOrFetchCompany(cik);
    const facts = await getFactsByCik(cik);
    res.json({ ...company, facts });
  } catch (err) {
    if (err instanceof CompanyFactsNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
