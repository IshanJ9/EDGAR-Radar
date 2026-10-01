import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, test, vi } from 'vitest';
import { App } from '../App';
import { resetDataCache } from '../lib/useData';

// Cut down from the production API's real answers for Apple (2026-10-02).
const COMPANIES = {
  count: 3,
  companies: [
    { cik: '0000320193', ticker: 'AAPL', name: 'Apple Inc.', industry: 'Electronic Computers', ratings: {} },
    { cik: '0000019617', ticker: 'JPM', name: 'JPMORGAN CHASE & CO', industry: 'National Commercial Banks', ratings: {} },
    { cik: '0000040545', ticker: 'GE', name: 'GENERAL ELECTRIC CO', industry: 'Aircraft Engines & Engine Parts', ratings: {} },
  ],
};

const APPLE_SCORES = {
  cik: '0000320193',
  scores: {
    altmanZ: {
      status: 'ok',
      value: 2.308,
      classification: 'grey-zone',
      inputs: {
        fiscalYear: 2025,
        workingCapital: -17674000000,
        totalAssets: 359241000000,
        retainedEarnings: -14264000000,
        ebit: 133050000000,
        bookValueOfEquity: 73733000000,
        totalLiabilities: 285508000000,
        liabilitiesDerived: false,
      },
    },
    piotroskiF: {
      status: 'ok',
      value: 8,
      classification: 'high-quality',
      inputs: {
        fiscalYearCurrent: 2025,
        fiscalYearPrior: 2024,
        signals: {
          positiveROA: true,
          positiveCFO: true,
          improvingROA: true,
          cfoExceedsNetIncome: false,
          decreasingLeverage: true,
          improvingCurrentRatio: true,
          noNewShares: true,
          improvingGrossMargin: true,
          improvingAssetTurnover: true,
        },
        derived: ['grossProfit'],
      },
    },
    beneishM: {
      status: 'ok',
      value: -2.295,
      classification: 'unlikely-manipulator',
      inputs: {
        fiscalYearCurrent: 2025,
        fiscalYearPrior: 2024,
        derived: [],
        indices: { dsri: 1.1187, gmi: 0.9851, aqi: 0.9863, sgi: 1.0643, depi: 1.0539, sgai: 0.9938, tata: 0.0015, lvgi: 0.9455 },
      },
    },
  },
};

const UNSCORED = (reason: string) => ({ status: 'insufficient-history', reason });
const JPM_SCORES = {
  cik: '0000019617',
  scores: {
    altmanZ: UNSCORED('Missing most-recent-fiscal-year data for: currentAssets, currentLiabilities, ebit.'),
    piotroskiF: UNSCORED('Need 2 fiscal years of data; missing for: currentAssets, currentLiabilities, grossProfit.'),
    beneishM: UNSCORED('Need 2 fiscal years of data; missing for: currentAssets, currentLiabilities, grossProfit, receivables, sga.'),
  },
};
const GE_SCORES = {
  cik: '0000040545',
  scores: {
    altmanZ: UNSCORED('No single fiscal year is available for every figure (assets 2025/2024; ebit 2012/2011).'),
    piotroskiF: { ...APPLE_SCORES.scores.piotroskiF, value: 5, classification: 'moderate' },
    beneishM: APPLE_SCORES.scores.beneishM,
  },
};

const series = (values: number[]) => values.map((value, i) => ({ fiscalYear: 2021 + i, value }));
const APPLE_FINANCIALS = {
  cik: '0000320193',
  latestAnnualReportFiled: '2025-10-31',
  revenue: series([365817e6, 394328e6, 383285e6, 391035e6, 416161e6]),
  netIncome: series([94680e6, 99803e6, 96995e6, 93736e6, 112010e6]),
  totalAssets: series([351002e6, 352755e6, 352583e6, 364980e6, 359241e6]),
  totalLiabilities: series([287912e6, 302083e6, 290437e6, 308030e6, 285508e6]),
  liabilitiesDerived: false,
  longTermDebt: series([109106e6, 98959e6, 95281e6, 85750e6, 78328e6]),
  operatingCashFlow: series([104038e6, 122151e6, 110543e6, 118254e6, 111482e6]),
};

const chunk = (status: string, text: string, matchedText: string | null = null) => ({ status, text, similarity: 0.5, matchedText });
const APPLE_DIFF = {
  cik: '0000320193',
  currentFilingDate: '2025-10-31T00:00:00.000Z',
  priorFilingDate: '2024-11-01T00:00:00.000Z',
  summary: { added: 2, removed: 7, modified: 1, unchanged: 1 },
  chunks: [
    chunk('new', 'New tariffs on imports from China, India and the European Union could raise costs.'),
    chunk('new', 'A court ordered certain remedies in a search-distribution case.'),
    ...Array.from({ length: 7 }, (_, i) => chunk('removed', `Removed risk number ${i + 1} about supply constraints.`)),
    chunk('modified', 'Global markets for our products are highly competitive and rapidly changing.', 'Global markets for the Company’s products are highly competitive.'),
    chunk('unchanged', 'An unchanged paragraph.'),
  ],
};

/** Text a screen reader announces - not the gauges' zone labels, which are hidden from assistive technology. */
const SPOKEN = { ignore: '[aria-hidden="true"] *, script, style' };

type Answers = Record<string, unknown>;

/** Answers each API path from `answers`: a number is that HTTP status. */
function stubApi(answers: Answers) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (!(path in answers)) throw new Error(`Unexpected request ${path}`);
    const answer = answers[path];
    return typeof answer === 'number' ? new Response('{"error":"x"}', { status: answer }) : Response.json(answer);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const APPLE_API: Answers = {
  '/api/companies': COMPANIES,
  '/api/companies/0000320193/scores': APPLE_SCORES,
  '/api/companies/0000320193/financials': APPLE_FINANCIALS,
  '/api/companies/0000320193/risk-factor-diff': APPLE_DIFF,
};

function openCompany(ticker: string) {
  resetDataCache();
  render(
    <MemoryRouter initialEntries={[`/company/${ticker}`]}>
      <App />
    </MemoryRouter>,
  );
  return userEvent.setup();
}

describe('the company page', () => {
  test('heads the page with the name, ticker, industry, latest annual report and a link to the source filings', async () => {
    stubApi(APPLE_API);
    openCompany('AAPL');

    expect(await screen.findByRole('heading', { level: 1, name: 'Apple Inc.' })).toBeInTheDocument();
    expect(screen.getByText('AAPL')).toBeInTheDocument();
    expect(await screen.findByText(/Electronic Computers · latest annual report filed Oct 31, 2025/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /original filings on sec\.gov/i })).toHaveAttribute(
      'href',
      'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000320193&type=10-K',
    );
    expect(document.title).toBe('Apple Inc. (AAPL) - EDGAR Radar');
  });

  test('sums up the scores in one sentence', async () => {
    stubApi(APPLE_API);
    openCompany('AAPL');

    expect(
      await screen.findByText(
        'Apple Inc. passes 8 of 9 financial-strength checks and shows no accounting red flags, but its bankruptcy-risk score is in the caution zone.',
      ),
    ).toBeInTheDocument();
  });

  test('shows each score with a plain-English badge and the reasons behind it', async () => {
    stubApi(APPLE_API);
    openCompany('AAPL');

    const altman = await screen.findByRole('article', { name: 'Bankruptcy risk' });
    expect(within(altman).getByText('Caution', SPOKEN)).toBeInTheDocument();
    expect(within(altman).getByText('2.31')).toBeInTheDocument();
    expect(within(altman).getByText('Short-term debts exceed short-term assets by $17.7B.')).toBeInTheDocument();

    const piotroski = screen.getByRole('article', { name: 'Financial strength' });
    expect(within(piotroski).getByText('Strong')).toBeInTheDocument();
    expect(within(piotroski).getByText('Cash beats reported profit')).toBeInTheDocument();
    expect(within(piotroski).getByText(/revenue minus cost of revenue/)).toBeInTheDocument();

    const beneish = screen.getByRole('article', { name: 'Accounting red flags' });
    expect(within(beneish).getByText('None found', SPOKEN)).toBeInTheDocument();
    expect(within(beneish).getByText('−2.30')).toBeInTheDocument();
  });

  test('charts five years of revenue and profit, with a table of the same numbers', async () => {
    stubApi(APPLE_API);
    openCompany('AAPL');

    const table = await screen.findByRole('table', { name: /revenue and profit by fiscal year/i });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(6); // header + 5 years
    expect(within(rows[5]!).getByText('2025')).toBeInTheDocument();
    expect(within(rows[5]!).getByText('$416.2B')).toBeInTheDocument();
    expect(within(rows[5]!).getByText('$112.0B')).toBeInTheDocument();
  });

  test('shows what it owns and owes in its latest year', async () => {
    stubApi(APPLE_API);
    openCompany('AAPL');

    const section = await screen.findByRole('region', { name: /what it owns and owes/i });
    expect(within(section).getByText('Fiscal 2025')).toBeInTheDocument();
    expect(within(section).getByText('$359.2B')).toBeInTheDocument();
    expect(within(section).getByText('$285.5B')).toBeInTheDocument();
    expect(within(section).getByText('$78.3B')).toBeInTheDocument();
    expect(within(section).getByText('$111.5B')).toBeInTheDocument();
  });

  test("lists what changed in its risk warnings: new first, then removed and reworded on their tabs", async () => {
    stubApi(APPLE_API);
    const user = openCompany('AAPL');

    const section = await screen.findByRole('region', { name: /what changed in apple inc\.'s risk warnings/i });
    expect(await within(section).findByText(/annual report filed oct 31, 2025, compared with the one filed nov 1, 2024/i)).toBeInTheDocument();
    expect(within(section).getByText(/New tariffs on imports/)).toBeInTheDocument();

    await user.click(within(section).getByRole('tab', { name: /removed \(7\)/i }));
    expect(within(section).getAllByText(/Removed risk number/)).toHaveLength(5); // the first five
    await user.click(within(section).getByRole('button', { name: /show 2 more/i }));
    expect(within(section).getAllByText(/Removed risk number/)).toHaveLength(7);

    await user.click(within(section).getByRole('tab', { name: /reworded \(1\)/i }));
    expect(within(section).getByText(/rapidly changing/)).toBeInTheDocument();
    expect(within(section).getByText(/Global markets for the Company’s products are highly competitive\./)).toBeInTheDocument();
  });
});

describe('when a score cannot be calculated', () => {
  test('a bank is told plainly that these scores do not fit banks', async () => {
    stubApi({
      '/api/companies': COMPANIES,
      '/api/companies/0000019617/scores': JPM_SCORES,
      '/api/companies/0000019617/financials': { ...APPLE_FINANCIALS, cik: '0000019617' },
      '/api/companies/0000019617/risk-factor-diff': 404,
    });
    openCompany('JPM');

    expect(await screen.findByRole('heading', { name: /these scores don't fit banks/i })).toBeInTheDocument();
    expect(screen.queryByText(/in short/i)).not.toBeInTheDocument();
  });

  test('another company sees, per score, why it is missing - and the rest still shows', async () => {
    stubApi({
      '/api/companies': COMPANIES,
      '/api/companies/0000040545/scores': GE_SCORES,
      '/api/companies/0000040545/financials': { ...APPLE_FINANCIALS, cik: '0000040545' },
      '/api/companies/0000040545/risk-factor-diff': 404,
    });
    openCompany('GE');

    const altman = await screen.findByRole('article', { name: 'Bankruptcy risk' });
    expect(within(altman).getByText('Not available')).toBeInTheDocument();
    expect(within(altman).getByText("The company's latest figures don't all cover the same year yet.")).toBeInTheDocument();
    expect(within(screen.getByRole('article', { name: 'Financial strength' })).getByText('Moderate')).toBeInTheDocument();
  });

  test('no stored risk-factor comparison is explained, not shown as an error', async () => {
    stubApi({
      '/api/companies': COMPANIES,
      '/api/companies/0000040545/scores': GE_SCORES,
      '/api/companies/0000040545/financials': { ...APPLE_FINANCIALS, cik: '0000040545' },
      '/api/companies/0000040545/risk-factor-diff': 404,
    });
    openCompany('GE');

    expect(await screen.findByText(/no comparison of its risk warnings yet/i)).toBeInTheDocument();
  });
});

describe('loading and errors', () => {
  test('a section that fails says so, offers to try again - and the rest of the page still works', async () => {
    const fetchMock = stubApi({ ...APPLE_API, '/api/companies/0000320193/scores': 500 });
    const user = openCompany('AAPL');

    const retry = await screen.findByRole('button', { name: /try again/i });
    expect(screen.getByText(/couldn't load the health check/i)).toBeInTheDocument();
    expect(await screen.findByRole('table', { name: /revenue and profit by fiscal year/i })).toBeInTheDocument();

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => Response.json(APPLE_API[String(input)]));
    await user.click(retry);

    expect(await screen.findByRole('article', { name: 'Bankruptcy risk' })).toBeInTheDocument();
  });

  test('sections show they are loading until their data arrives', async () => {
    stubApi(APPLE_API);
    openCompany('AAPL');

    expect(await screen.findAllByText(/loading/i)).not.toHaveLength(0);
    await screen.findByRole('article', { name: 'Bankruptcy risk' });
  });
});
