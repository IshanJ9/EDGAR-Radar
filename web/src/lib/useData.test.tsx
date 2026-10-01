import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { resetDataCache, useCompanies, useScores } from './useData';

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

// F3: per-company data.
describe('useScores', () => {
  test("moving to another company shows that company's data, never the previous one's", async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => Response.json({ cik: String(input).split('/')[3], scores: {} })));
    resetDataCache();

    const { result, rerender } = renderHook(({ cik }) => useScores(cik), { initialProps: { cik: '0000320193' } });
    await waitFor(() => expect(result.current.data).toMatchObject({ cik: '0000320193' }));
    rerender({ cik: '0000789019' });

    expect(result.current.data).toBeNull(); // loading, not Apple's
    await waitFor(() => expect(result.current.data).toMatchObject({ cik: '0000789019' }));
  });

  test('retry loads again after a failure', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 503 })).mockResolvedValue(Response.json({ cik: '0000320193', scores: {} }));
    vi.stubGlobal('fetch', fetchMock);
    resetDataCache();

    const { result } = renderHook(() => useScores('0000320193'));
    await waitFor(() => expect(result.current.failed).toBe(true));
    act(() => result.current.retry());

    await waitFor(() => expect(result.current.data).toMatchObject({ cik: '0000320193' }));
    expect(result.current.failed).toBe(false);
  });
});
