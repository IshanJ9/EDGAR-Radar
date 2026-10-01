/**
 * The rest of the site (post-Phase 7 hardening, step 3, F4-F5): navigation,
 * All companies, Latest filings, How it works, and the polish on the company
 * page. Data is cut down from the production API's real answers.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, test, vi } from 'vitest';
import { App } from '../App';
import { resetDataCache } from '../lib/useData';

const ok = (value: number, classification: string) => ({ status: 'ok', value, classification });
const NONE = { status: 'insufficient-history' };
const UNSCORED = { status: 'insufficient-history', reason: 'Missing most-recent-fiscal-year data for: ebit.' };
const company = (cik: string, ticker: string, name: string, industry: string | null, ratings: Record<string, unknown>) => ({ cik, ticker, name, industry, ratings });

const APPLE = company('0000320193', 'AAPL', 'Apple Inc.', 'Electronic Computers', {
  altmanZ: ok(2.308, 'grey-zone'),
  piotroskiF: ok(8, 'high-quality'),
  beneishM: ok(-2.295, 'unlikely-manipulator'),
});
const AMAT = company('0000006951', 'AMAT', 'APPLIED MATERIALS INC /DE', 'Special Industry Machinery', {
  altmanZ: ok(8.1, 'safe'),
  piotroskiF: ok(6, 'moderate'),
  beneishM: ok(-2.6, 'unlikely-manipulator'),
});
const JPM = company('0000019617', 'JPM', 'JPMORGAN CHASE & CO', 'National Commercial Banks', { altmanZ: NONE, piotroskiF: NONE, beneishM: NONE });
const MSFT = company('0000789019', 'MICROSOFT', 'MICROSOFT CORP', null, { altmanZ: ok(4, 'safe'), piotroskiF: NONE, beneishM: NONE });
const MSFT_FIXED = { ...MSFT, ticker: 'MSFT' };
// 26 more companies, enough for a second page of 25.
const FILLER = Array.from({ length: 26 }, (_, i) =>
  company(`00000010${String(i).padStart(2, '0')}`, `Z${String.fromCharCode(65 + i)}`, `Zeta Holdings ${String.fromCharCode(65 + i)}`, null, {
    altmanZ: ok(3, 'safe'),
    piotroskiF: ok(5, 'moderate'),
    beneishM: ok(-2.5, 'unlikely-manipulator'),
  }),
);
const COMPANIES = { count: 30, companies: [APPLE, AMAT, JPM, MSFT_FIXED, ...FILLER] };

const NOW = Date.now();
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const STATS = {
  companiesMonitored: 196,
  factsStored: 16394,
  filingsDiscoveredLast24h: 427,
  lastPoll: { finishedAt: ago(12), companiesChecked: 196, newFilingsFound: 3 },
  lastReconciliation: { finishedAt: ago(600), companiesChecked: 196, discrepanciesFound: 5 },
};

const f = (accessionNumber: string, cik: string, ticker: string, name: string, form: string, category: string, minutesAgo: number) => ({
  accessionNumber,
  cik,
  form,
  filingDate: '2026-10-01',
  discoveredAt: ago(minutesAgo),
  ticker,
  name,
  category,
});
const FEED = (hours: number) => ({
  windowHours: hours,
  total: 9,
  countsByCategory: { offering: 4, 'insider-trade': 2, 'major-event': 1, 'annual-report': 1, merger: 1 },
  filings: [
    f('1', '0000320193', 'AAPL', 'Apple Inc.', '4', 'insider-trade', 30),
    f('2', '0000320193', 'AAPL', 'Apple Inc.', '4', 'insider-trade', 45),
    f('3', '0000789019', 'MSFT', 'MICROSOFT CORP', '8-K', 'major-event', 90),
    f('4', '0000006951', 'AMAT', 'APPLIED MATERIALS INC /DE', '10-K', 'annual-report', 200),
    f('5', '0000019617', 'JPM', 'JPMORGAN CHASE & CO', '425', 'merger', hours > 24 ? 3000 : 300),
  ],
});

function stubApi(overrides: Record<string, unknown> = {}) {
  const answers: Record<string, unknown> = {
    '/api/companies': COMPANIES,
    '/api/stats': STATS,
    '/api/filings/recent?hours=24&exclude=offering': FEED(24),
    '/api/filings/recent?hours=168&exclude=offering': FEED(168),
    ...overrides,
  };
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (!(path in answers)) return new Response('{"error":"not stubbed"}', { status: 404 });
    const answer = answers[path];
    return typeof answer === 'number' ? new Response('{}', { status: answer }) : Response.json(answer);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function open(path: string) {
  resetDataCache();
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  return userEvent.setup();
}

const rowNames = (table: HTMLElement) =>
  within(table)
    .getAllByRole('row')
    .slice(1)
    .map((r) => within(r).getByRole('link').textContent);

describe('navigation', () => {
  test('every page links to the other pages', async () => {
    stubApi();
    open('/');

    const nav = screen.getByRole('navigation', { name: /main/i });
    expect(within(nav).getByRole('link', { name: 'All companies' })).toHaveAttribute('href', '/companies');
    expect(within(nav).getByRole('link', { name: 'Latest filings' })).toHaveAttribute('href', '/filings');
    expect(within(nav).getByRole('link', { name: 'How it works' })).toHaveAttribute('href', '/how-it-works');
    expect(screen.getByRole('contentinfo')).toContainElement(screen.getByRole('link', { name: /how edgar radar works/i }));
  });

  test('on a phone the links fold into a menu button', async () => {
    stubApi();
    const user = open('/');

    const menu = screen.getByRole('button', { name: /menu/i });
    expect(menu).toHaveAttribute('aria-expanded', 'false');
    await user.click(menu);
    expect(menu).toHaveAttribute('aria-expanded', 'true');
  });

  test('inner pages carry a search box in the header; the home page has only its own', async () => {
    stubApi();
    open('/companies');
    const header = screen.getByRole('banner');
    expect(await within(header).findByRole('combobox', { name: /search for a company/i })).toBeInTheDocument();
  });

  test('the home page has one search box, not two', async () => {
    stubApi();
    open('/');
    await screen.findByText(/watching 196 companies/i);
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
  });
});

describe('All companies', () => {
  test('lists every company alphabetically with its three ratings', async () => {
    stubApi();
    open('/companies');

    expect(await screen.findByRole('heading', { level: 1, name: 'All 30 companies' })).toBeInTheDocument();
    const table = screen.getByRole('table', { name: /companies and their health ratings/i });
    expect(rowNames(table).slice(0, 4)).toEqual(['AApple Inc.AAPL', 'AApplied Materials IncAMAT', 'JJPMorgan Chase & CoJPM', 'MMicrosoft CorpMSFT']);

    const apple = within(table).getAllByRole('row')[1]!;
    expect(within(apple).getByText('Caution')).toBeInTheDocument();
    expect(within(apple).getByText('2.31')).toBeInTheDocument();
    expect(within(apple).getByText('8/9')).toBeInTheDocument();
    expect(within(apple).getByText('−2.30')).toBeInTheDocument();
    expect(within(apple).getByRole('link')).toHaveAttribute('href', '/company/AAPL');
  });

  test('a bank says it is not scored; a company short of figures says so', async () => {
    stubApi();
    open('/companies');

    const table = await screen.findByRole('table', { name: /companies and their health ratings/i });
    const [jpm, msft] = [within(table).getAllByRole('row')[3]!, within(table).getAllByRole('row')[4]!];
    expect(within(jpm).getAllByText('Not scored (bank)')).toHaveLength(3);
    expect(within(msft).getAllByText('Not enough data')).toHaveLength(2);
  });

  test('says how many have all three scores and how many none, from the live list', async () => {
    stubApi();
    open('/companies');

    expect(await screen.findByText(/28 of 30/)).toBeInTheDocument();
    expect(screen.getByText(/have all three scores and/)).toHaveTextContent('1 have none');
  });

  test('filters by name or ticker as you type', async () => {
    stubApi();
    const user = open('/companies');

    await user.type(await screen.findByRole('textbox', { name: /filter companies/i }), 'appl');

    expect(rowNames(screen.getByRole('table'))).toEqual(['AApple Inc.AAPL', 'AApplied Materials IncAMAT']);
  });

  test('"Any caution or flag" keeps only companies with a concern', async () => {
    stubApi();
    const user = open('/companies');

    await user.click(await screen.findByRole('button', { name: /any caution or flag/i }));

    expect(rowNames(screen.getByRole('table'))).toEqual(['AApple Inc.AAPL']);
    expect(screen.getByRole('button', { name: /any caution or flag/i })).toHaveAttribute('aria-pressed', 'true');
  });

  test('shows 25 at a time, with next and previous pages', async () => {
    stubApi();
    const user = open('/companies');

    expect(await screen.findByText('Showing 1–25 of 30')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByText('Showing 26–30 of 30')).toBeInTheDocument();
    expect(rowNames(screen.getByRole('table'))).toHaveLength(5);
  });
});

describe('Latest filings', () => {
  test("folds a company's filings of one kind into one line, linked to the company", async () => {
    stubApi();
    open('/filings');

    const apple = await screen.findByRole('link', { name: /apple inc\..*2 insider trades reported/i });
    expect(apple).toHaveAttribute('href', '/company/AAPL');
    expect(screen.getByRole('link', { name: /microsoft corp.*reported a major event/i })).toBeInTheDocument();
  });

  test('routine bond paperwork is summed up in one line instead of listed', async () => {
    stubApi();
    open('/filings');

    expect(await screen.findByText(/4 routine offers of notes and bonds/i)).toBeInTheDocument();
  });

  test('the filter buttons narrow the list', async () => {
    stubApi();
    const user = open('/filings');

    await user.click(await screen.findByRole('button', { name: 'Annual and quarterly reports' }));

    expect(screen.getByRole('link', { name: /applied materials inc.*filed its annual report/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /apple inc\./i })).not.toBeInTheDocument();
  });

  test('shows the totals and when the poller last checked', async () => {
    stubApi();
    open('/filings');

    const side = await screen.findByRole('complementary');
    expect(await within(side).findByText('9')).toBeInTheDocument();
    expect(await within(side).findByText('12 min ago')).toBeInTheDocument();
  });

  test('can widen to the last seven days', async () => {
    const fetchMock = stubApi();
    const user = open('/filings');

    await user.click(await screen.findByRole('button', { name: /show the last 7 days/i }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Latest filings' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/filings/recent?hours=168&exclude=offering', expect.anything());
    expect(await screen.findByText(/in the last 7 days/i)).toBeInTheDocument();
  });

  test('if the feed cannot be loaded, it says so and can try again', async () => {
    stubApi({ '/api/filings/recent?hours=24&exclude=offering': 503 });
    open('/filings');

    expect(await screen.findByText(/couldn't load the latest filings/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});

describe('How it works', () => {
  test('explains the six steps, the live numbers, the three scores and where the data comes from', async () => {
    stubApi();
    open('/how-it-works');

    expect(screen.getByRole('heading', { level: 1, name: 'How EDGAR Radar works' })).toBeInTheDocument();
    for (const step of ['Watch', 'Read', 'Check', 'Score', 'Compare', 'Guard']) {
      expect(screen.getByRole('heading', { level: 3, name: step })).toBeInTheDocument();
    }
    const now = screen.getByRole('region', { name: /right now/i });
    expect(await within(now).findByText('12 min ago')).toBeInTheDocument();
    expect(within(now).getByText('427')).toBeInTheDocument();
    expect(within(now).getByText('16,394')).toBeInTheDocument();
    expect(within(now).getByText(/figures corrected in last night's cross-check of 196 companies/i)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /the three health scores/i })).toHaveAttribute('id', 'scores');
    expect(screen.getByRole('link', { name: /read the code on github/i })).toHaveAttribute('href', 'https://github.com/IshanJ9/EDGAR-Radar');
  });
});

describe('the company page, polished', () => {
  test('links to how the scores work and says when filings were last checked', async () => {
    stubApi({
      // /scores always gives a reason with an unscored result (the list's summaries do not).
      '/api/companies/0000320193/scores': { cik: '0000320193', scores: { altmanZ: UNSCORED, piotroskiF: UNSCORED, beneishM: UNSCORED } },
      '/api/companies/0000320193/financials': {
        cik: '0000320193',
        latestAnnualReportFiled: null,
        revenue: [],
        netIncome: [],
        totalAssets: [],
        totalLiabilities: [],
        liabilitiesDerived: false,
        longTermDebt: [],
        operatingCashFlow: [],
      },
    });
    open('/company/AAPL');

    expect(await screen.findByRole('link', { name: /how these scores work/i })).toHaveAttribute('href', '/how-it-works#scores');
    expect(await screen.findByText(/filings last checked 12 min ago/i)).toBeInTheDocument();
  });
});

describe('the not-found page', () => {
  test('asks search engines not to index it', async () => {
    stubApi();
    open('/nowhere');

    expect(await screen.findByRole('heading', { name: /page not found/i })).toBeInTheDocument();
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
  });
});
