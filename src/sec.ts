import { TokenBucket } from './rateLimiter';
import { fetchWithRetry } from './retry';
import { optionalEnv, requireEnv } from './config';

const CONTACT_EMAIL = requireEnv('EDGAR_CONTACT_EMAIL');
const USER_AGENT = `EDGAR Radar (${CONTACT_EMAIL})`;

/**
 * SEC's rate limit is 10 requests per second for the whole host (CLAUDE.md:
 * stay at 5-8), but this limiter only governs its own process - and several
 * processes call SEC. So each process gets a share of one budget through
 * SEC_REQUESTS_PER_SECOND, set per service in docker-compose.yml.
 *
 * A token bucket admits at most `capacity + rate` requests in any one-second
 * window: a full bucket, plus a second of refill. Summed over every process,
 * that is what has to stay at or under 10. Hence a burst capacity of 1 - the
 * old `TokenBucket(7, 7)` allowed 14 in a second from a single process, so
 * the API and parser worker together could in principle send 28.
 * src/__tests__/secBudget.test.ts checks the sum against docker-compose.yml.
 *
 * 7 is only the default for a process run on its own (`npm run backfill` on
 * a development machine), where nothing else shares the budget.
 */
export const SEC_BURST_CAPACITY = 1;
export const SEC_REQUESTS_PER_SECOND = Number(optionalEnv('SEC_REQUESTS_PER_SECOND') ?? 7);
const secRateLimiter = new TokenBucket(SEC_REQUESTS_PER_SECOND, SEC_BURST_CAPACITY);

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- SEC's raw companyfacts JSON is genuinely untyped here (deeply nested, shape varies per company/tag); every caller reads it through mostRecentFact/annualFacts, which validate what they need at runtime instead.
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
  /** Standard Industrial Classification code and description, e.g. "6021", "National Commercial Banks". */
  sic?: string;
  sicDescription?: string;
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- same untyped raw companyfacts JSON as fetchCompanyFacts above.
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
  facts: UsGaapFact[]; // most recent `count` fiscal years, newest first; `fy` is the period's own fiscal year
}

const DAY_MS = 86_400_000;

/**
 * The fiscal year a period belongs to: the calendar year its period ends in
 * (Apple's year ending 2025-09-27 is fiscal 2025, Walmart's ending 2026-01-31
 * is fiscal 2026). NOT SEC's `fy` field, which is the fiscal year of the
 * filing that reported the value - see annualFacts.
 */
export function fiscalYearOfPeriod(end: string): number {
  return Number(end.slice(0, 4));
}

/** A balance-sheet value (no start) or a duration of roughly a year - not a quarter reported inside a 10-K. */
function coversAFullYear(fact: UsGaapFact): boolean {
  if (!fact.start) return true;
  const days = (Date.parse(fact.end) - Date.parse(fact.start)) / DAY_MS;
  return days >= 330 && days <= 400;
}

/**
 * Returns up to `count` most recent *annual* values (form 10-K, fp 'FY', a
 * full year) for one of the candidate tags, newest first. Unlike
 * `mostRecentFact`, this never returns a quarterly figure - the ratio-score
 * formulas compare one full fiscal year against another, and a partial year
 * would silently corrupt the ratio.
 *
 * Values are chosen by the PERIOD they cover (their `end` date), and each
 * returned fact's `fy` is replaced with that period's fiscal year. SEC's own
 * `fy` is the fiscal year of the filing: every 10-K restates earlier years
 * (three years of income, two balance sheets) under its own `fy`. Keeping one
 * value per SEC `fy` - as this did until post-Phase 7 hardening, step 3 -
 * stored Apple's "fiscal 2025" revenue as the year ended September 2023 and
 * never stored 2024 or 2025 at all, so every score paired stale, mismatched
 * years. A period reported by several 10-Ks keeps the most recently filed
 * value, so a restatement wins.
 *
 * Tags are never mixed within a result: two tags aren't guaranteed to mean
 * the same thing (mixing `LongTermDebt` for one year with
 * `LongTermDebtNoncurrent` for another, a real pattern in Tesla's data,
 * would silently produce an invalid comparison). Among the tags with at least
 * `minimum` years, the one with the most recent period wins, then priority
 * order - so a tag a company stopped using years ago can no longer shadow the
 * one it reports today (JPMorgan's stored long-term debt was from 2011-12).
 *
 * `maxFiscalYear`, when given, restricts to periods in fiscal years at or
 * before it - for Phase 5's back-testing, which needs a specific historical
 * pair of years.
 */
export function annualFacts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- same untyped raw companyfacts JSON as fetchCompanyFacts above.
  companyFacts: any,
  tags: string[],
  unit: 'USD' | 'shares',
  count: number,
  maxFiscalYear?: number,
  minimum: number = Math.min(count, 2),
): AnnualFactResult | null {
  let best: AnnualFactResult | null = null;

  for (const tag of tags) {
    const values: UsGaapFact[] | undefined = companyFacts?.facts?.['us-gaap']?.[tag]?.units?.[unit];
    if (!Array.isArray(values) || values.length === 0) continue;

    const byPeriodEnd = new Map<string, UsGaapFact>();
    for (const fact of values) {
      if (fact.form !== '10-K' || fact.fp !== 'FY' || !coversAFullYear(fact)) continue;
      if (maxFiscalYear !== undefined && fiscalYearOfPeriod(fact.end) > maxFiscalYear) continue;
      const existing = byPeriodEnd.get(fact.end);
      if (!existing || fact.filed > existing.filed) byPeriodEnd.set(fact.end, fact);
    }

    // Newest period first; one per fiscal year (a changed year-end can put
    // two period ends in one calendar year - the later one stands).
    const facts: UsGaapFact[] = [];
    for (const fact of [...byPeriodEnd.values()].sort((a, b) => b.end.localeCompare(a.end))) {
      const fy = fiscalYearOfPeriod(fact.end);
      if (facts.length === 0 || facts[facts.length - 1]!.fy !== fy) facts.push({ ...fact, fy });
    }

    if (facts.length < minimum) continue;
    if (!best || facts[0]!.end > best.facts[0]!.end) best = { tag, unit, facts };
  }

  return best && { ...best, facts: best.facts.slice(0, count) };
}
