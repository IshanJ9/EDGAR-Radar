import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { resetDataCache, useCompanies } from './useData';

const COMPANIES = { count: 1, companies: [{ cik: '0000320193', ticker: 'AAPL', name: 'Apple Inc.', industry: null, ratings: {} }] };

describe('useCompanies', () => {
  test('loads the list once and shares it between pages', async () => {
    const fetchMock = vi.fn(async () => Response.json(COMPANIES));
    vi.stubGlobal('fetch', fetchMock);
    resetDataCache();

    const first = renderHook(() => useCompanies());
    await waitFor(() => expect(first.result.current.data).toHaveLength(1));
    const second = renderHook(() => useCompanies());
    await waitFor(() => expect(second.result.current.data).toHaveLength(1));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('a failed load is not remembered: the next page that needs the list tries again', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 503 })).mockResolvedValue(Response.json(COMPANIES));
    vi.stubGlobal('fetch', fetchMock);
    resetDataCache();

    const first = renderHook(() => useCompanies());
    await waitFor(() => expect(first.result.current.failed).toBe(true));
    const second = renderHook(() => useCompanies());

    await waitFor(() => expect(second.result.current.data).toHaveLength(1));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
