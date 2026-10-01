import { useEffect, useState } from 'react';
import { fetchCompanies, fetchStats, type Company, type PipelineStats } from './api';

/**
 * Loads data once per page view and shares it: the company list feeds the
 * search, the "try" links and every company page, so moving between pages
 * never refetches it.
 */
type State<T> = { data: T | null; failed: boolean };

const cache = new Map<string, Promise<unknown>>();

function useCached<T>(key: string, load: () => Promise<T>): State<T> {
  const [state, setState] = useState<State<T>>({ data: null, failed: false });
  useEffect(() => {
    let current = true;
    let promise = cache.get(key) as Promise<T> | undefined;
    if (!promise) {
      promise = load();
      cache.set(key, promise);
      // A failure is not cached: the next page that needs the data tries again.
      promise.catch(() => cache.delete(key));
    }
    promise.then(
      (data) => current && setState({ data, failed: false }),
      () => current && setState({ data: null, failed: true }),
    );
    return () => {
      current = false;
    };
  }, [key, load]);
  return state;
}

export const useCompanies = () => useCached<Company[]>('companies', fetchCompanies);
export const useStats = () => useCached<PipelineStats>('stats', fetchStats);

/** Tests only: forget everything loaded so far. */
export function resetDataCache() {
  cache.clear();
}
