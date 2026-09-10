import { TokenBucket } from './rateLimiter';

const CONTACT_EMAIL = process.env.EDGAR_CONTACT_EMAIL;
if (!CONTACT_EMAIL) {
  throw new Error('Missing EDGAR_CONTACT_EMAIL in .env (see .env.example).');
}
const USER_AGENT = `EDGAR Radar (${CONTACT_EMAIL})`;

// SEC's hard limit is 10 req/s; CLAUDE.md says stay at 5-8/s, so 7 targets
// the middle of that range with a small burst allowance.
const secRateLimiter = new TokenBucket(7, 7);

export interface UsGaapFact {
  start?: string;
  end: string;
  val: number;
  fy: number;
  fp: string;
  form: string;
  filed: string;
  accn: string;
}

export class CompanyFactsNotFoundError extends Error {}

export function padCik(cik: string): string {
  return cik.padStart(10, '0');
}

/** Rate-limited fetch with SEC's required User-Agent header, shared by every SEC caller. */
export async function secFetch(url: string): Promise<Response> {
  await secRateLimiter.acquire();
  return fetch(url, { headers: { 'User-Agent': USER_AGENT } });
}

export async function fetchCompanyFacts(cik: string): Promise<any> {
  const paddedCik = padCik(cik);
  const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${paddedCik}.json`;

  const response = await secFetch(url);

  if (!response.ok) {
    if (response.status === 404) {
      throw new CompanyFactsNotFoundError(
        `No XBRL company facts found for CIK ${paddedCik}. Either the CIK is invalid, or the company has never filed XBRL data.`,
      );
    }
    throw new Error(`Request to ${url} failed with status ${response.status}.`);
  }

  return response.json();
}

export interface SecSubmissions {
  filings: {
    recent: {
      accessionNumber: string[];
      filingDate: string[];
      form: string[];
      primaryDocument: string[];
    };
  };
}

export async function fetchSubmissions(cik: string): Promise<SecSubmissions> {
  const paddedCik = padCik(cik);
  const url = `https://data.sec.gov/submissions/CIK${paddedCik}.json`;

  const response = await secFetch(url);
  if (!response.ok) {
    throw new Error(`Request to ${url} failed with status ${response.status}.`);
  }
  return response.json();
}

export interface FilingReference {
  accessionNumber: string;
  filingDate: string;
  form: string;
  primaryDocument: string;
}

/** SEC's submissions API lists recent filings newest-first; this returns the first match. */
export function findMostRecentFiling(submissions: SecSubmissions, formTypes: string[]): FilingReference | null {
  const { recent } = submissions.filings;
  const idx = recent.form.findIndex((form) => formTypes.includes(form));
  if (idx === -1) return null;
  return {
    accessionNumber: recent.accessionNumber[idx]!,
    filingDate: recent.filingDate[idx]!,
    form: recent.form[idx]!,
    primaryDocument: recent.primaryDocument[idx]!,
  };
}

export function mostRecentFact(
  companyFacts: any,
  tags: string[],
): { tag: string; fact: UsGaapFact } | null {
  let best: { tag: string; fact: UsGaapFact } | null = null;
  for (const tag of tags) {
    const values: UsGaapFact[] | undefined = companyFacts?.facts?.['us-gaap']?.[tag]?.units?.USD;
    if (!Array.isArray(values) || values.length === 0) continue;
    const latest = [...values].sort((a, b) => a.end.localeCompare(b.end)).at(-1)!;
    if (!best || latest.end > best.fact.end) {
      best = { tag, fact: latest };
    }
  }
  return best;
}

export const REVENUE_TAGS = ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax'];
export const NET_INCOME_TAGS = ['NetIncomeLoss', 'ProfitLoss'];
