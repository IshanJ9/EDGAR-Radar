import { describe, expect, test } from 'vitest';
import { describeGroup, groupFilings, matchesFilter, relativeTime, type Filing } from './feed';

const filing = (over: Partial<Filing>): Filing => ({
  accessionNumber: 'a',
  cik: '0000320193',
  form: '4',
  filingDate: '2026-10-01',
  discoveredAt: '2026-10-01T19:00:00.000Z',
  ticker: 'AAPL',
  name: 'Apple Inc.',
  category: 'insider-trade',
  ...over,
});

describe('groupFilings', () => {
  test("one company's filings of one kind become one line, newest first, with a count", () => {
    const groups = groupFilings([
      filing({ accessionNumber: '1', discoveredAt: '2026-10-01T19:30:00.000Z' }),
      filing({ accessionNumber: '2', discoveredAt: '2026-10-01T19:10:00.000Z' }),
      filing({ accessionNumber: '3', cik: '0000789019', ticker: 'MSFT', name: 'MICROSOFT CORP', category: 'major-event', form: '8-K', discoveredAt: '2026-10-01T19:20:00.000Z' }),
    ]);

    expect(groups.map((g) => [g.ticker, g.category, g.count, g.latestAt])).toEqual([
      ['AAPL', 'insider-trade', 2, '2026-10-01T19:30:00.000Z'],
      ['MSFT', 'major-event', 1, '2026-10-01T19:20:00.000Z'],
    ]);
    expect(groups[1]!.displayName).toBe('Microsoft Corp');
  });
});

describe('describeGroup', () => {
  test('says what happened in plain English', () => {
    expect(describeGroup({ category: 'major-event', count: 1, forms: ['8-K'] })).toBe('Reported a major event');
    expect(describeGroup({ category: 'insider-trade', count: 6, forms: ['4'] })).toBe('6 insider trades reported');
    expect(describeGroup({ category: 'insider-trade', count: 1, forms: ['144'] })).toBe('An insider gave notice of a planned share sale');
    expect(describeGroup({ category: 'annual-report', count: 1, forms: ['10-K'] })).toBe('Filed its annual report');
    expect(describeGroup({ category: 'quarterly-report', count: 1, forms: ['10-Q'] })).toBe('Filed its quarterly report');
    expect(describeGroup({ category: 'merger', count: 2, forms: ['425'] })).toBe('Published 2 communications about a merger');
    expect(describeGroup({ category: 'other', count: 1, forms: ['SD'] })).toBe('Filed its conflict-minerals report');
    expect(describeGroup({ category: 'other', count: 1, forms: ['N-PX'] })).toBe('Filed a form N-PX');
  });
});

describe('matchesFilter', () => {
  test('the filter buttons each cover their categories', () => {
    expect(matchesFilter('everything', 'other')).toBe(true);
    expect(matchesFilter('reports', 'annual-report')).toBe(true);
    expect(matchesFilter('reports', 'quarterly-report')).toBe(true);
    expect(matchesFilter('reports', 'major-event')).toBe(false);
    expect(matchesFilter('insider', 'insider-trade')).toBe(true);
  });
});

describe('relativeTime', () => {
  const now = new Date('2026-10-01T20:00:00.000Z');
  test('minutes, hours, then days', () => {
    expect(relativeTime('2026-10-01T19:59:40.000Z', now)).toBe('just now');
    expect(relativeTime('2026-10-01T19:35:00.000Z', now)).toBe('25 min ago');
    expect(relativeTime('2026-10-01T18:00:00.000Z', now)).toBe('2 hr ago');
    expect(relativeTime('2026-09-29T20:00:00.000Z', now)).toBe('2 days ago');
    expect(relativeTime('2026-09-30T19:00:00.000Z', now)).toBe('1 day ago');
  });
});
