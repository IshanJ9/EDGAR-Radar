import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchCompanies,
  fetchFinancials,
  fetchRiskFactorDiff,
  fetchScores,
  fetchStats,
  type Company,
  type CompanyFinancials,
  type CompanyScores,
  type PipelineStats,
  type RiskFactorDiff,
} from './api';

/**
 * Loads data once per page view and shares it: the company list feeds the
 * search, the "try" links and every company page, so moving between pages
 * never refetches it. Per-company data is keyed by CIK.
 */
export interface DataState<T> {
  /** The data, or null while loading (or after a failure). */
  data: T | null;
  /** True once the data arrived - for data that can itself be null, such as "no diff stored". */
  loaded: boolean;
  failed: boolean;
  /** Load again - for a "Try again" button after a failure. */
  retry: () => void;
}

const cache = new Map<string, Promise<unknown>>();

function useCached<T>(key: string, load: () => Promise<T>): DataState<T> {
  // Which key the state belongs to: moving to another company must show it
  // loading, never the previous company's data.
  const [state, setState] = useState<{ key: string; data: T | null; loaded: boolean; failed: boolean }>({ key, data: null, loaded: false, failed: false });
  const [attempt, setAttempt] = useState(0);
  // The loader for the current key; kept in a ref so the fetch effect depends
  // on the key alone. Updated in an effect, never during render.
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    let current = true;
    let promise = cache.get(key) as Promise<T> | undefined;
    if (!promise) {
      promise = loadRef.current();
      cache.set(key, promise);
      // A failure is not cached: the next page that needs the data tries again.
      promise.catch(() => cache.delete(key));
    }
    promise.then(
      (data) => current && setState({ key, data, loaded: true, failed: false }),
      () => current && setState({ key, data: null, loaded: false, failed: true }),
    );
    return () => {
      current = false;
    };
  }, [key, attempt]);

  const retry = useCallback(() => {
    setState({ key, data: null, loaded: false, failed: false });
    setAttempt((n) => n + 1);
  }, [key]);

  const mine = state.key === key;
  return { data: mine ? state.data : null, loaded: mine && state.loaded, failed: mine && state.failed, retry };
}

export const useCompanies = () => useCached<Company[]>('companies', fetchCompanies);
export const useStats = () => useCached<PipelineStats>('stats', fetchStats);
export const useScores = (cik: string) => useCached<CompanyScores>(`scores:${cik}`, () => fetchScores(cik));
export const useFinancials = (cik: string) => useCached<CompanyFinancials>(`financials:${cik}`, () => fetchFinancials(cik));
export const useRiskFactorDiff = (cik: string) => useCached<RiskFactorDiff | null>(`risk-factor-diff:${cik}`, () => fetchRiskFactorDiff(cik));

/** Tests only: forget everything loaded so far. */
export function resetDataCache() {
  cache.clear();
}
