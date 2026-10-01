import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, test, vi } from 'vitest';
import { App } from '../App';
import { resetDataCache } from '../lib/useData';

const COMPANIES = {
  count: 3,
  companies: [
    { cik: '0000320193', ticker: 'AAPL', name: 'Apple Inc.', industry: 'Electronic Computers', ratings: {} },
    { cik: '0000789019', ticker: 'MSFT', name: 'MICROSOFT CORP', industry: null, ratings: {} },
    { cik: '0001318605', ticker: 'TSLA', name: 'Tesla, Inc.', industry: null, ratings: {} },
  ],
};
const STATS = {
  companiesMonitored: 196,
  factsStored: 16394,
  filingsDiscoveredLast24h: 400,
  lastPoll: { finishedAt: '2026-10-01T09:01:38.163Z', companiesChecked: 196, newFilingsFound: 0 },
  lastReconciliation: { finishedAt: '2026-10-01T02:00:20.053Z', companiesChecked: 196, discrepanciesFound: 5 },
};

/** Answers /api/companies and /api/stats; `failing` paths answer 503. */
function stubApi(failing: string[] = []) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (failing.includes(path)) return new Response('{}', { status: 503 });
      if (path === '/api/companies') return Response.json(COMPANIES);
      if (path === '/api/stats') return Response.json(STATS);
      throw new Error(`Unexpected request ${path}`);
    }),
  );
}

function renderHome() {
  resetDataCache();
  render(
    <MemoryRouter initialEntries={['/']}>
      <App />
    </MemoryRouter>,
  );
}

describe('HomePage', () => {
  test('shows the live numbers from the API', async () => {
    stubApi();
    renderHome();

    expect(await screen.findByText('Watching 196 companies · checked every 30 minutes')).toBeInTheDocument();
    const band = screen.getByRole('region', { name: /by the numbers/i });
    expect(within(band).getByText('16,394')).toBeInTheDocument();
    expect(within(band).getByText('400')).toBeInTheDocument();
  });

  test('offers a few companies to try, each linking to its page', async () => {
    stubApi();
    renderHome();

    const link = await screen.findByRole('link', { name: 'Microsoft Corp' });
    expect(link).toHaveAttribute('href', '/company/MSFT');
  });

  test('if the numbers cannot be loaded, the page still works - the band shows dashes', async () => {
    stubApi(['/api/stats']);
    renderHome();

    // The search, which needs only the company list, still offers companies.
    expect(await screen.findByRole('link', { name: 'Microsoft Corp' })).toBeInTheDocument();
    const band = screen.getByRole('region', { name: /by the numbers/i });
    expect(await within(band).findAllByText('—')).toHaveLength(2);
    // The count falls back to the company list itself.
    expect(screen.getByText('Watching 3 companies · checked every 30 minutes')).toBeInTheDocument();
  });

  test('the page title names the site', async () => {
    stubApi();
    renderHome();

    await screen.findByText(/watching 196 companies/i);
    expect(document.title).toBe('EDGAR Radar - plain-English health checks for big US companies');
  });
});

describe('routing', () => {
  test('an unknown address shows a friendly 404 with a way home', async () => {
    stubApi();
    resetDataCache();
    render(
      <MemoryRouter initialEntries={['/no-such-page']}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: /page not found/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to the home page/i })).toHaveAttribute('href', '/');
  });

  test("a company's address shows its name until the full page arrives (F3)", async () => {
    stubApi();
    resetDataCache();
    render(
      <MemoryRouter initialEntries={['/company/MSFT']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Microsoft Corp' })).toBeInTheDocument();
  });

  test('a ticker EDGAR Radar does not cover is a 404, not an empty company page', async () => {
    stubApi();
    resetDataCache();
    render(
      <MemoryRouter initialEntries={['/company/TM']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: /page not found/i })).toBeInTheDocument();
  });
});
