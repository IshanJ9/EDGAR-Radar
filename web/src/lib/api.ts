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
