/**
 * Automated accessibility check of every page with axe-core (F5): no
 * violations of WCAG 2.1 A/AA rules axe can test. jsdom has no layout or
 * computed colours, so colour contrast is checked in a real browser instead
 * (see PROGRESS.md); everything else - names, roles, labels, landmarks,
 * heading order, ARIA - is checked here on the real pages with real-shaped data.
 */
import { render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { MemoryRouter } from 'react-router';
import { describe, expect, test, vi } from 'vitest';
import { App } from '../App';
import { resetDataCache } from '../lib/useData';

const ok = (value: number, classification: string) => ({ status: 'ok', value, classification });
const APPLE = {
  cik: '0000320193',
  ticker: 'AAPL',
  name: 'Apple Inc.',
  industry: 'Electronic Computers',
  ratings: { altmanZ: ok(2.308, 'grey-zone'), piotroskiF: ok(8, 'high-quality'), beneishM: ok(-2.295, 'unlikely-manipulator') },
};
const series = (values: number[]) => values.map((value, i) => ({ fiscalYear: 2021 + i, value }));
const ANSWERS: Record<string, unknown> = {
  '/api/companies': { count: 1, companies: [APPLE] },
  '/api/stats': {
    companiesMonitored: 196,
    factsStored: 16394,
    filingsDiscoveredLast24h: 427,
    lastPoll: { finishedAt: new Date().toISOString(), companiesChecked: 196, newFilingsFound: 0 },
    lastReconciliation: { finishedAt: new Date().toISOString(), companiesChecked: 196, discrepanciesFound: 5 },
  },
  '/api/filings/recent?hours=24&exclude=offering': {
    windowHours: 24,
    total: 3,
    countsByCategory: { offering: 2, 'major-event': 1 },
    filings: [
      { accessionNumber: '1', cik: '0000320193', form: '8-K', filingDate: '2026-10-01', discoveredAt: new Date().toISOString(), ticker: 'AAPL', name: 'Apple Inc.', category: 'major-event' },
    ],
  },
  '/api/companies/0000320193/scores': {
    cik: '0000320193',
    scores: {
      altmanZ: { ...ok(2.308, 'grey-zone'), inputs: { fiscalYear: 2025, workingCapital: -1e10, totalAssets: 3e11, retainedEarnings: -1e10, ebit: 1e11, bookValueOfEquity: 7e10, totalLiabilities: 2e11, liabilitiesDerived: false } },
      piotroskiF: { ...ok(8, 'high-quality'), inputs: { fiscalYearCurrent: 2025, fiscalYearPrior: 2024, signals: { positiveROA: true }, derived: [] } },
      beneishM: { ...ok(-2.295, 'unlikely-manipulator'), inputs: { fiscalYearCurrent: 2025, fiscalYearPrior: 2024, derived: [], indices: {} } },
    },
  },
  '/api/companies/0000320193/financials': {
    cik: '0000320193',
    latestAnnualReportFiled: '2025-10-31',
    revenue: series([1, 2, 3]),
    netIncome: series([1, 1, 1]),
    totalAssets: series([5, 5, 5]),
    totalLiabilities: series([3, 3, 3]),
    liabilitiesDerived: false,
    longTermDebt: series([1, 1, 1]),
    operatingCashFlow: series([1, 1, 1]),
  },
  '/api/companies/0000320193/risk-factor-diff': {
    cik: '0000320193',
    currentFilingDate: '2025-10-31',
    priorFilingDate: '2024-11-01',
    summary: { added: 1, removed: 1, modified: 1, unchanged: 1 },
    chunks: [
      { status: 'new', text: 'A new risk.', similarity: null },
      { status: 'removed', text: 'An old risk.', similarity: null },
      { status: 'modified', text: 'A reworded risk.', similarity: 0.8, matchedText: 'A risk.' },
    ],
  },
};

async function violationsOn(path: string, ready: () => Promise<unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => (String(input) in ANSWERS ? Response.json(ANSWERS[String(input)]) : new Response('{}', { status: 404 }))),
  );
  resetDataCache();
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  await ready();
  const results = await axe.run(document.body, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
    rules: { 'color-contrast': { enabled: false } },
  });
  return results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`);
}

describe('accessibility (axe-core)', () => {
  test('home page', async () => {
    expect(await violationsOn('/', () => screen.findByText(/watching 196 companies/i))).toEqual([]);
  });

  test('company page', async () => {
    expect(await violationsOn('/company/AAPL', () => screen.findByRole('tab', { name: /new \(1\)/i }))).toEqual([]);
  });

  test('all companies', async () => {
    expect(await violationsOn('/companies', () => screen.findByRole('table'))).toEqual([]);
  });

  test('latest filings', async () => {
    expect(await violationsOn('/filings', () => screen.findByText(/reported a major event/i))).toEqual([]);
  });

  test('how it works', async () => {
    expect(await violationsOn('/how-it-works', () => screen.findByText('427'))).toEqual([]);
  });

  test('not found', async () => {
    expect(await violationsOn('/nowhere', () => screen.findByRole('heading', { name: /page not found/i }))).toEqual([]);
  });
});
