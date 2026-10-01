/**
 * Post-Phase 7 hardening, step 3 (F3) - the figures behind the company page's
 * charts. The tag choice is the scores' own (getAnnualValues, with the same
 * tag lists), so a chart and a score never disagree about which figure is
 * "revenue". The repository is mocked; its SQL is tested in
 * scoringRepository.integration.test.ts and companyRepository.integration.test.ts.
 */
jest.mock('../repositories/scoringRepository');
jest.mock('../repositories/companyRepository', () => ({ getLatestAnnualReportFiledDate: jest.fn() }));

import {
  ASSETS_TAGS,
  LIABILITIES_TAGS,
  LONG_TERM_DEBT_TAGS,
  NET_INCOME_TAGS,
  OPERATING_CASH_FLOW_TAGS,
  REVENUE_TAGS,
  STOCKHOLDERS_EQUITY_TAGS,
} from '../sec';
import { AnnualValue, getAnnualValues } from '../repositories/scoringRepository';
import { getLatestAnnualReportFiledDate } from '../repositories/companyRepository';
import { getCompanyFinancials } from '../companyFinancials';

const years = (newest: number, ...values: number[]): AnnualValue[] => values.map((value, i) => ({ fiscalYear: newest - i, value }));

function fixtures(map: Map<string[], AnnualValue[]>) {
  jest.mocked(getAnnualValues).mockImplementation(async (_cik, tags) => map.get(tags) ?? []);
}

const FULL = () =>
  new Map<string[], AnnualValue[]>([
    [REVENUE_TAGS, years(2025, 416, 391, 383, 394, 365)],
    [NET_INCOME_TAGS, years(2025, 112, 93, 97, 99, 94)],
    [ASSETS_TAGS, years(2025, 359, 365)],
    [LIABILITIES_TAGS, years(2025, 285, 308)],
    [STOCKHOLDERS_EQUITY_TAGS, years(2025, 74, 57)],
    [LONG_TERM_DEBT_TAGS, years(2025, 78, 85)],
    [OPERATING_CASH_FLOW_TAGS, years(2025, 111, 118)],
  ]);

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(getLatestAnnualReportFiledDate).mockResolvedValue('2025-10-31');
});

describe('getCompanyFinancials', () => {
  test('returns up to five years of each figure, oldest first for charts, from the same tag lists the scores use', async () => {
    fixtures(FULL());

    const financials = await getCompanyFinancials('320193');

    expect(financials.revenue).toEqual([
      { fiscalYear: 2021, value: 365 },
      { fiscalYear: 2022, value: 394 },
      { fiscalYear: 2023, value: 383 },
      { fiscalYear: 2024, value: 391 },
      { fiscalYear: 2025, value: 416 },
    ]);
    expect(financials.netIncome.at(-1)).toEqual({ fiscalYear: 2025, value: 112 });
    expect(financials.longTermDebt).toHaveLength(2);
    expect(getAnnualValues).toHaveBeenCalledWith('0000320193', REVENUE_TAGS, 5);
  });

  test('includes when the latest annual report was filed', async () => {
    fixtures(FULL());

    await expect(getCompanyFinancials('320193')).resolves.toMatchObject({ cik: '0000320193', latestAnnualReportFiled: '2025-10-31' });
  });

  test('reported liabilities are used as reported', async () => {
    fixtures(FULL());

    const financials = await getCompanyFinancials('320193');

    expect(financials.totalLiabilities.at(-1)).toEqual({ fiscalYear: 2025, value: 285 });
    expect(financials.liabilitiesDerived).toBe(false);
  });

  test('stale or missing liabilities are derived as assets minus equity, for every year - like the Altman score', async () => {
    const map = FULL();
    map.set(LIABILITIES_TAGS, years(2010, 999));
    fixtures(map);

    const financials = await getCompanyFinancials('313616');

    expect(financials.totalLiabilities).toEqual([
      { fiscalYear: 2024, value: 308 },
      { fiscalYear: 2025, value: 285 },
    ]);
    expect(financials.liabilitiesDerived).toBe(true);
  });

  test('a company with no figures at all gets empty series, not an error', async () => {
    fixtures(new Map());
    jest.mocked(getLatestAnnualReportFiledDate).mockResolvedValue(null);

    const financials = await getCompanyFinancials('2115436');

    expect(financials.revenue).toEqual([]);
    expect(financials.totalLiabilities).toEqual([]);
    expect(financials.latestAnnualReportFiled).toBeNull();
  });
});
