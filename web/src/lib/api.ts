import { displayName } from './names';

/**
 * Typed access to the EDGAR Radar API. Everything goes through the site's
 * own /api path, which Vercel (vercel.json) and `npm run dev`
 * (vite.config.ts) proxy to the API - so the browser never needs the API's
 * address and no CORS setup is involved.
 */
const BASE = '/api';

export class ApiError extends Error {
  /** The HTTP status, or null when the request never got a response. */
  readonly status: number | null;

  constructor(message: string, status: number | null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function getJson<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, { headers: { Accept: 'application/json' } });
  } catch (err) {
    throw new ApiError(`Could not reach the EDGAR Radar API (${err instanceof Error ? err.message : String(err)})`, null);
  }
  if (!response.ok) throw new ApiError(`EDGAR Radar API answered ${response.status} for ${path}`, response.status);
  return (await response.json()) as T;
}

export type RatingSummary = { status: 'ok'; value: number; classification: string } | { status: 'insufficient-history' };

export interface Company {
  cik: string;
  ticker: string;
  /** SEC's official registrant name. */
  name: string;
  /** The name as a visitor should read it - see lib/names.ts. */
  displayName: string;
  /** SEC's industry description, e.g. "Electronic Computers"; null until the poller has seen the company. */
  industry: string | null;
  ratings: { altmanZ?: RatingSummary; piotroskiF?: RatingSummary; beneishM?: RatingSummary };
}

export async function fetchCompanies(): Promise<Company[]> {
  const body = await getJson<{ count: number; companies: Omit<Company, 'displayName'>[] }>('/companies');
  return body.companies.map((c) => ({ ...c, displayName: displayName(c.ticker, c.name) }));
}

interface RunSummary {
  finishedAt: string;
  companiesChecked: number;
}

export interface PipelineStats {
  companiesMonitored: number;
  factsStored: number;
  filingsDiscoveredLast24h: number;
  lastPoll: (RunSummary & { newFilingsFound: number }) | null;
  lastReconciliation: (RunSummary & { discrepanciesFound: number }) | null;
}

export function fetchStats(): Promise<PipelineStats> {
  return getJson<PipelineStats>('/stats');
}

// --- The company page (post-Phase 7 hardening, step 3, F3).

export type ScoreOutcome<TInputs> =
  | { status: 'ok'; value: number; classification: string; inputs: TInputs }
  | { status: 'insufficient-history'; reason: string };

export interface AltmanInputs {
  fiscalYear: number;
  workingCapital: number;
  totalAssets: number;
  retainedEarnings: number;
  ebit: number;
  bookValueOfEquity: number;
  totalLiabilities: number;
  liabilitiesDerived: boolean;
}

export interface PiotroskiInputs {
  fiscalYearCurrent: number;
  fiscalYearPrior: number;
  signals: Record<string, boolean>;
  derived: string[];
}

export interface BeneishInputs {
  fiscalYearCurrent: number;
  fiscalYearPrior: number;
  indices: Record<string, number>;
  derived: string[];
}

export interface CompanyScores {
  cik: string;
  scores: {
    altmanZ: ScoreOutcome<AltmanInputs>;
    piotroskiF: ScoreOutcome<PiotroskiInputs>;
    beneishM: ScoreOutcome<BeneishInputs>;
  };
}

export interface AnnualValue {
  fiscalYear: number;
  value: number;
}

export interface CompanyFinancials {
  cik: string;
  latestAnnualReportFiled: string | null;
  revenue: AnnualValue[];
  netIncome: AnnualValue[];
  totalAssets: AnnualValue[];
  totalLiabilities: AnnualValue[];
  liabilitiesDerived: boolean;
  longTermDebt: AnnualValue[];
  operatingCashFlow: AnnualValue[];
}

export interface DiffChunk {
  text: string;
  status: 'new' | 'removed' | 'modified' | 'unchanged';
  similarity: number | null;
  /** For a reworded chunk, the closest paragraph in the other year's filing. */
  matchedText?: string | null;
}

export interface RiskFactorDiff {
  cik: string;
  currentFilingDate: string;
  priorFilingDate: string;
  summary: { added: number; removed: number; modified: number; unchanged: number };
  chunks: DiffChunk[];
}

export const fetchScores = (cik: string) => getJson<CompanyScores>(`/companies/${cik}/scores`);
export const fetchFinancials = (cik: string) => getJson<CompanyFinancials>(`/companies/${cik}/financials`);

/**
 * The stored comparison of the company's last two 10-Ks, or null when none is
 * stored - a normal state (fewer than two 10-Ks, or no Risk Factors section
 * found), which the page explains rather than shows as an error.
 */
export async function fetchRiskFactorDiff(cik: string): Promise<RiskFactorDiff | null> {
  try {
    return await getJson<RiskFactorDiff>(`/companies/${cik}/risk-factor-diff`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}
