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
export class SubmissionsNotFoundError extends Error {}

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
    if (response.status === 404) {
      throw new SubmissionsNotFoundError(`No SEC submissions found for CIK ${paddedCik}. The CIK is likely invalid.`);
    }
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

/**
 * Like `findMostRecentFiling`, but returns up to `count` matches instead of
 * just the first. SEC's submissions API already lists `recent` newest-first,
 * so unlike the XBRL fiscal-year matching in `annualFacts`, no re-sorting or
 * dedup is needed - each 10-K is already a distinct, chronologically-ordered
 * filing. Used for risk-factor-section diffing, which needs a company's two
 * most recent 10-Ks, not just the latest one.
 */
export function findRecentFilings(submissions: SecSubmissions, formTypes: string[], count: number): FilingReference[] {
  const { recent } = submissions.filings;
  const indexes = recent.form.map((form, idx) => (formTypes.includes(form) ? idx : -1)).filter((idx) => idx !== -1);
  return indexes.slice(0, count).map((idx) => ({
    accessionNumber: recent.accessionNumber[idx]!,
    filingDate: recent.filingDate[idx]!,
    form: recent.form[idx]!,
    primaryDocument: recent.primaryDocument[idx]!,
  }));
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

// SalesRevenueNet/SalesRevenueGoodsNet were the standard revenue tags
// before the ASC 606 revenue-recognition standard (mandatory ~2018)
// introduced RevenueFromContractWithCustomerExcludingAssessedTax - confirmed
// for real against Under Armour and Kraft Heinz's actual pre-2018 filings
// during Phase 5 step 6's back-testing, which specifically needs older
// historical fiscal years these newer tags don't cover.
export const REVENUE_TAGS = [
  'Revenues',
  'RevenueFromContractWithCustomerExcludingAssessedTax',
  'SalesRevenueNet',
  'SalesRevenueGoodsNet',
];
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
// Confirmed against Kraft Heinz's real data (Phase 5 step 6 back-testing):
// a third real-world variant, used by heavily-leveraged companies that
// combine long-term debt and capital lease obligations under one tag.
export const LONG_TERM_DEBT_TAGS = ['LongTermDebtNoncurrent', 'LongTermDebt', 'LongTermDebtAndCapitalLeaseObligations'];
export const SHARES_OUTSTANDING_TAGS = ['CommonStockSharesOutstanding']; // unit: shares, not USD
export const GROSS_PROFIT_TAGS = ['GrossProfit'];
export const RECEIVABLES_TAGS = ['AccountsReceivableNetCurrent'];
export const PPE_TAGS = ['PropertyPlantAndEquipmentNet'];
// DepreciationAndAmortization (no "Depletion") confirmed as a 4th real
// variant against Under Armour's actual pre-2018 filings (Phase 5 step 6).
export const DEPRECIATION_TAGS = [
  'DepreciationDepletionAndAmortization',
  'DepreciationAmortizationAndAccretionNet',
  'Depreciation',
  'DepreciationAndAmortization',
];
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
 *
 * `maxFiscalYear`, when given, restricts the pool to fiscal years at or
 * before it before taking the most recent `count` - added for Phase 5's
 * back-testing step, which needs a specific *historical* fiscal-year pair
 * (e.g. the two years surrounding a known accounting irregularity), not
 * whatever is most recent as of today.
 */
export function annualFacts(
  companyFacts: any,
  tags: string[],
  unit: 'USD' | 'shares',
  count: number,
  maxFiscalYear?: number,
): AnnualFactResult | null {
  for (const tag of tags) {
    const values: UsGaapFact[] | undefined = companyFacts?.facts?.['us-gaap']?.[tag]?.units?.[unit];
    if (!Array.isArray(values) || values.length === 0) continue;

    const annualByFiscalYear = new Map<number, UsGaapFact>();
    for (const fact of values) {
      if (fact.form !== '10-K' || fact.fp !== 'FY') continue;
      if (maxFiscalYear !== undefined && fact.fy > maxFiscalYear) continue;
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
