import { TokenBucket } from './rateLimiter';
import { fetchWithRetry } from './retry';

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

/**
 * Rate-limited, retrying fetch with SEC's required User-Agent header, shared
 * by every SEC caller (companyfacts, submissions, filing documents, the bulk
 * archive). Each retry attempt re-acquires a rate-limiter token, since a
 * retry is a genuine new request against SEC.
 */
export async function secFetch(url: string): Promise<Response> {
  return fetchWithRetry(async () => {
    await secRateLimiter.acquire();
    return fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  });
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

// Phase 5 ratio-score inputs. Each is a fallback list, same pattern as
// REVENUE_TAGS/NET_INCOME_TAGS above - real companies genuinely differ in
// which XBRL tag they report a concept under (confirmed against real Apple
// and Tesla data: Tesla reports CostOfRevenue where Apple reports
// CostOfGoodsAndServicesSold, has both LongTermDebt and LongTermDebtNoncurrent
// with different year coverage, etc.).
export const ASSETS_TAGS = ['Assets'];
export const LIABILITIES_TAGS = ['Liabilities'];
export const CURRENT_ASSETS_TAGS = ['AssetsCurrent'];
export const CURRENT_LIABILITIES_TAGS = ['LiabilitiesCurrent'];
export const RETAINED_EARNINGS_TAGS = ['RetainedEarningsAccumulatedDeficit'];
export const OPERATING_INCOME_TAGS = ['OperatingIncomeLoss']; // used as the standard EBIT proxy
export const STOCKHOLDERS_EQUITY_TAGS = ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'];
export const OPERATING_CASH_FLOW_TAGS = ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'];
export const LONG_TERM_DEBT_TAGS = ['LongTermDebtNoncurrent', 'LongTermDebt'];
export const SHARES_OUTSTANDING_TAGS = ['CommonStockSharesOutstanding']; // unit: shares, not USD
export const GROSS_PROFIT_TAGS = ['GrossProfit'];
export const RECEIVABLES_TAGS = ['AccountsReceivableNetCurrent'];
export const PPE_TAGS = ['PropertyPlantAndEquipmentNet'];
export const DEPRECIATION_TAGS = ['DepreciationDepletionAndAmortization', 'DepreciationAmortizationAndAccretionNet', 'Depreciation'];
export const SGA_TAGS = ['SellingGeneralAndAdministrativeExpense'];

export interface AnnualFactResult {
  tag: string;
  unit: 'USD' | 'shares';
  facts: UsGaapFact[]; // most recent `count` distinct fiscal years, descending by fy
}

/**
 * Returns up to `count` most recent distinct-fiscal-year *annual* (form
 * 10-K, fp 'FY') values for whichever candidate tag (tried in priority
 * order) actually has enough annual history. Unlike `mostRecentFact`, this
 * never returns a quarterly/10-Q figure - that matters here because the
 * ratio-score formulas compare one full fiscal year against another, and
 * mixing in a partial-year figure would silently corrupt the ratio.
 *
 * Tags are tried independently rather than merged across a single result,
 * since two different tags aren't guaranteed to mean exactly the same
 * thing - mixing e.g. `LongTermDebt` for one year with
 * `LongTermDebtNoncurrent` for another (a real pattern seen in Tesla's own
 * data) could silently produce an invalid comparison.
 */
export function annualFacts(
  companyFacts: any,
  tags: string[],
  unit: 'USD' | 'shares',
  count: number,
): AnnualFactResult | null {
  for (const tag of tags) {
    const values: UsGaapFact[] | undefined = companyFacts?.facts?.['us-gaap']?.[tag]?.units?.[unit];
    if (!Array.isArray(values) || values.length === 0) continue;

    const annualByFiscalYear = new Map<number, UsGaapFact>();
    for (const fact of values) {
      if (fact.form !== '10-K' || fact.fp !== 'FY') continue;
      const existing = annualByFiscalYear.get(fact.fy);
      // A later 10-K can restate a prior fiscal year's figure - prefer
      // whichever was filed most recently for that fiscal year.
      if (!existing || fact.filed > existing.filed) {
        annualByFiscalYear.set(fact.fy, fact);
      }
    }

    if (annualByFiscalYear.size < count) continue;

    const sorted = [...annualByFiscalYear.values()].sort((a, b) => b.fy - a.fy);
    return { tag, unit, facts: sorted.slice(0, count) };
  }
  return null;
}
