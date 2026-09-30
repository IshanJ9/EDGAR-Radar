/**
 * Unit tests for the 3 ratio-score formulas in src/scoring.ts (Phase 6,
 * step 3: "Unit tests for parsers/scorers with fixture data").
 *
 * These functions are NOT pure - each fetches its inputs from Postgres via
 * `getAnnualValues` (src/repositories/scoringRepository.ts) before doing any
 * math. A genuine fixture-driven unit test therefore has to substitute
 * fixture data at that repository boundary rather than hit a real database -
 * that is what distinguishes this step from step 4 ("integration tests
 * against a throwaway test Postgres"), which is where these same functions
 * get tested against the real thing. `jest.mock` replaces
 * `getAnnualValues` with a fixture-backed fake; every formula, threshold,
 * and edge case below is otherwise exercised through the real, unmodified
 * exported functions.
 *
 * Every fixture's expected output was verified two ways before being written
 * here: by hand, and by re-computing it in a standalone script - not
 * reverse-engineered by running the function first and copying its answer.
 */
import {
  ASSETS_TAGS,
  LIABILITIES_TAGS,
  CURRENT_ASSETS_TAGS,
  CURRENT_LIABILITIES_TAGS,
  RETAINED_EARNINGS_TAGS,
  OPERATING_INCOME_TAGS,
  STOCKHOLDERS_EQUITY_TAGS,
  OPERATING_CASH_FLOW_TAGS,
  LONG_TERM_DEBT_TAGS,
  SHARES_OUTSTANDING_TAGS,
  GROSS_PROFIT_TAGS,
  RECEIVABLES_TAGS,
  PPE_TAGS,
  DEPRECIATION_TAGS,
  SGA_TAGS,
  REVENUE_TAGS,
  NET_INCOME_TAGS,
  COST_OF_REVENUE_TAGS,
  SELLING_MARKETING_TAGS,
  GENERAL_ADMIN_TAGS,
} from '../sec';
import { AnnualValue } from '../repositories/scoringRepository';

jest.mock('../repositories/scoringRepository');
import { getAnnualValues } from '../repositories/scoringRepository';
const mockedGetAnnualValues = getAnnualValues as jest.MockedFunction<typeof getAnnualValues>;

import { computeAltmanZDoublePrime, computePiotroskiFScore, computeBeneishMScore } from '../scoring';

/**
 * Builds the mock's implementation from a fixture map keyed by REFERENCE to
 * the same tag-array constants scoring.ts imports (e.g. `ASSETS_TAGS`) -
 * not by tag name string - so this can never silently mismatch if a
 * fallback tag list is ever reordered or extended.
 */
function fixtureRepository(fixtures: Map<string[], AnnualValue[]>) {
  mockedGetAnnualValues.mockImplementation(async (_cik, tags) => fixtures.get(tags) ?? []);
}

function years(fiscalYearCurrent: number, ...values: number[]): AnnualValue[] {
  return values.map((value, i) => ({ fiscalYear: fiscalYearCurrent - i, value }));
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe('computeAltmanZDoublePrime', () => {
  const oneYearConcepts = (overrides: Partial<Record<string, number>>) =>
    new Map<string[], AnnualValue[]>([
      [ASSETS_TAGS, years(2024, overrides.assets ?? 1000)],
      [CURRENT_ASSETS_TAGS, years(2024, overrides.currentAssets ?? 0)],
      [CURRENT_LIABILITIES_TAGS, years(2024, overrides.currentLiabilities ?? 0)],
      [RETAINED_EARNINGS_TAGS, years(2024, overrides.retainedEarnings ?? 0)],
      [OPERATING_INCOME_TAGS, years(2024, overrides.ebit ?? 0)],
      [STOCKHOLDERS_EQUITY_TAGS, years(2024, overrides.equity ?? 0)],
      [LIABILITIES_TAGS, overrides.liabilities === undefined ? [] : years(2024, overrides.liabilities)],
    ]);

  test('a clearly healthy company classifies as safe (Z" > 2.6)', async () => {
    fixtureRepository(
      oneYearConcepts({
        assets: 1000,
        currentAssets: 600,
        currentLiabilities: 200,
        retainedEarnings: 500,
        ebit: 200,
        equity: 800,
        liabilities: 200,
      }),
    );
    const result = await computeAltmanZDoublePrime('0000000001');
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('unreachable');
    expect(result.classification).toBe('safe');
    expect(result.value).toBeCloseTo(9.798, 2);
  });

  test('a heavily distressed company classifies as distress (Z" < 1.1)', async () => {
    fixtureRepository(
      oneYearConcepts({
        assets: 1000,
        currentAssets: 100,
        currentLiabilities: 400,
        retainedEarnings: -600,
        ebit: -100,
        equity: 100,
        liabilities: 900,
      }),
    );
    const result = await computeAltmanZDoublePrime('0000000001');
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('unreachable');
    expect(result.classification).toBe('distress');
    expect(result.value).toBeCloseTo(-4.479, 2);
  });

  test('a middling company classifies as grey-zone (1.1 < Z" <= 2.6)', async () => {
    fixtureRepository(
      oneYearConcepts({
        assets: 1000,
        currentAssets: 300,
        currentLiabilities: 200,
        retainedEarnings: 100,
        ebit: 50,
        equity: 300,
        liabilities: 700,
      }),
    );
    const result = await computeAltmanZDoublePrime('0000000001');
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('unreachable');
    expect(result.classification).toBe('grey-zone');
    expect(result.value).toBeCloseTo(1.768, 2);
  });

  test('derives total liabilities from Assets minus Equity when no combined Liabilities tag exists', async () => {
    // Mirrors a real, already-documented gap (AbbVie reports Assets and
    // StockholdersEquity every year but never a consolidated Liabilities
    // figure) - see the comment on computeAltmanZDoublePrime in scoring.ts.
    fixtureRepository(
      oneYearConcepts({
        assets: 1000,
        currentAssets: 300,
        currentLiabilities: 200,
        retainedEarnings: 100,
        ebit: 50,
        equity: 600,
        // liabilities intentionally omitted (undefined -> empty fixture array)
      }),
    );
    const result = await computeAltmanZDoublePrime('0000000001');
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('unreachable');
    expect(result.inputs.liabilitiesDerived).toBe(true);
    expect(result.inputs.totalLiabilities).toBe(400); // 1000 - 600
  });

  test('returns insufficient-history when a required concept has no data at all', async () => {
    const fixtures = oneYearConcepts({ assets: 1000, liabilities: 200 });
    fixtures.set(STOCKHOLDERS_EQUITY_TAGS, []); // no equity data ever reported
    fixtureRepository(fixtures);
    const result = await computeAltmanZDoublePrime('0000000001');
    expect(result.status).toBe('insufficient-history');
    if (result.status !== 'insufficient-history') throw new Error('unreachable');
    expect(result.reason).toContain('equity');
  });

  test('returns insufficient-history rather than dividing by zero when total assets is 0', async () => {
    fixtureRepository(
      oneYearConcepts({
        assets: 0,
        currentAssets: 100,
        currentLiabilities: 50,
        retainedEarnings: 10,
        ebit: 5,
        equity: 100,
        liabilities: 500,
      }),
    );
    const result = await computeAltmanZDoublePrime('0000000001');
    expect(result.status).toBe('insufficient-history');
  });
});

describe('computePiotroskiFScore', () => {
  const twoYearConcepts = (v: {
    assets: [number, number];
    currentAssets: [number, number];
    currentLiabilities: [number, number];
    longTermDebt: [number, number];
    cfo: [number, number];
    netIncome: [number, number];
    shares: [number, number];
    grossProfit: [number, number];
    revenue: [number, number];
  }) =>
    new Map<string[], AnnualValue[]>([
      [ASSETS_TAGS, years(2024, ...v.assets)],
      [CURRENT_ASSETS_TAGS, years(2024, ...v.currentAssets)],
      [CURRENT_LIABILITIES_TAGS, years(2024, ...v.currentLiabilities)],
      [LONG_TERM_DEBT_TAGS, years(2024, ...v.longTermDebt)],
      [OPERATING_CASH_FLOW_TAGS, years(2024, ...v.cfo)],
      [NET_INCOME_TAGS, years(2024, ...v.netIncome)],
      [SHARES_OUTSTANDING_TAGS, years(2024, ...v.shares)],
      [GROSS_PROFIT_TAGS, years(2024, ...v.grossProfit)],
      [REVENUE_TAGS, years(2024, ...v.revenue)],
    ]);

  test('every signal improving scores 9/9 and classifies as high-quality', async () => {
    fixtureRepository(
      twoYearConcepts({
        assets: [1000, 900],
        currentAssets: [500, 400],
        currentLiabilities: [200, 250],
        longTermDebt: [100, 150],
        cfo: [150, 100],
        netIncome: [100, 80],
        shares: [1000, 1000],
        grossProfit: [450, 350],
        revenue: [800, 700],
      }),
    );
    const result = await computePiotroskiFScore('0000000001');
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('unreachable');
    expect(result.value).toBe(9);
    expect(result.classification).toBe('high-quality');
    expect(result.inputs.signals.improvingGrossMargin).toBe(true);
  });

  test('every signal worsening scores 0/9 and classifies as low-quality', async () => {
    fixtureRepository(
      twoYearConcepts({
        assets: [1000, 900],
        currentAssets: [200, 400],
        currentLiabilities: [300, 150],
        longTermDebt: [300, 100],
        cfo: [-50, 100],
        netIncome: [-20, 50],
        shares: [1100, 1000],
        grossProfit: [300, 500],
        revenue: [800, 800],
      }),
    );
    const result = await computePiotroskiFScore('0000000001');
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('unreachable');
    expect(result.value).toBe(0);
    expect(result.classification).toBe('low-quality');
  });

  test('a mixed 7/9 result classifies as moderate, not high-quality', async () => {
    fixtureRepository(
      twoYearConcepts({
        assets: [1000, 900],
        currentAssets: [500, 400],
        currentLiabilities: [200, 250],
        longTermDebt: [100, 150],
        cfo: [150, 100],
        netIncome: [100, 80],
        shares: [1100, 1000], // flipped: noNewShares now false
        grossProfit: [300, 350], // flipped: improvingGrossMargin now false
        revenue: [800, 700],
      }),
    );
    const result = await computePiotroskiFScore('0000000001');
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('unreachable');
    expect(result.value).toBe(7);
    expect(result.classification).toBe('moderate');
    expect(result.inputs.signals.noNewShares).toBe(false);
    expect(result.inputs.signals.improvingGrossMargin).toBe(false);
  });

  test('returns insufficient-history when only 1 fiscal year exists for a concept', async () => {
    const fixtures = twoYearConcepts({
      assets: [1000, 900],
      currentAssets: [500, 400],
      currentLiabilities: [200, 250],
      longTermDebt: [100, 150],
      cfo: [150, 100],
      netIncome: [100, 80],
      shares: [1000, 1000],
      grossProfit: [450, 350],
      revenue: [800, 700],
    });
    fixtures.set(REVENUE_TAGS, years(2024, 800)); // only 1 year, not 2
    fixtureRepository(fixtures);
    const result = await computePiotroskiFScore('0000000001');
    expect(result.status).toBe('insufficient-history');
    if (result.status !== 'insufficient-history') throw new Error('unreachable');
    expect(result.reason).toContain('revenue');
  });

  test('returns insufficient-history rather than dividing by zero when revenue is 0 in either year', async () => {
    fixtureRepository(
      twoYearConcepts({
        assets: [1000, 900],
        currentAssets: [500, 400],
        currentLiabilities: [200, 250],
        longTermDebt: [100, 150],
        cfo: [150, 100],
        netIncome: [100, 80],
        shares: [1000, 1000],
        grossProfit: [450, 350],
        revenue: [0, 700], // current-year revenue is 0
      }),
    );
    const result = await computePiotroskiFScore('0000000001');
    expect(result.status).toBe('insufficient-history');
  });
});

describe('computeBeneishMScore', () => {
  // Every concept identical across both fiscal years, so every ratio-based
  // index (dsri/gmi/aqi/sgi/depi/sgai/lvgi) evaluates to exactly 1 - only
  // `tata` (net income minus CFO, over assets) varies between the two test
  // cases below. Verified independently (see the commit's PROGRESS.md
  // entry) that this baseline yields M = -2.480 when tata = 0.
  const baseline = (niT: number, cfoT: number) =>
    new Map<string[], AnnualValue[]>([
      [ASSETS_TAGS, years(2024, 1000, 1000)],
      [CURRENT_ASSETS_TAGS, years(2024, 300, 300)],
      [CURRENT_LIABILITIES_TAGS, years(2024, 200, 200)],
      [LONG_TERM_DEBT_TAGS, years(2024, 100, 100)],
      [OPERATING_CASH_FLOW_TAGS, years(2024, cfoT, 100)],
      [NET_INCOME_TAGS, years(2024, niT, 100)],
      [REVENUE_TAGS, years(2024, 800, 800)],
      [GROSS_PROFIT_TAGS, years(2024, 400, 400)],
      [RECEIVABLES_TAGS, years(2024, 80, 80)],
      [PPE_TAGS, years(2024, 200, 200)],
      [DEPRECIATION_TAGS, years(2024, 50, 50)],
      [SGA_TAGS, years(2024, 100, 100)],
    ]);

  test('a company with no unusual year-over-year movement (tata=0) classifies as unlikely-manipulator', async () => {
    fixtureRepository(baseline(100, 100)); // niT === cfoT -> tata = 0
    const result = await computeBeneishMScore('0000000001');
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('unreachable');
    expect(result.value).toBeCloseTo(-2.48, 2);
    expect(result.classification).toBe('unlikely-manipulator');
  });

  test('a large, unexplained accruals gap (high tata) pushes M above the -2.22 threshold to likely-manipulator', async () => {
    fixtureRepository(baseline(600, 100)); // (600-100)/1000 = 0.5 tata
    const result = await computeBeneishMScore('0000000001');
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('unreachable');
    expect(result.value).toBeCloseTo(-0.1405, 1);
    expect(result.classification).toBe('likely-manipulator');
  });

  test('returns insufficient-history when a required concept is missing entirely', async () => {
    const fixtures = baseline(100, 100);
    fixtures.set(SGA_TAGS, []);
    fixtureRepository(fixtures);
    const result = await computeBeneishMScore('0000000001');
    expect(result.status).toBe('insufficient-history');
    if (result.status !== 'insufficient-history') throw new Error('unreachable');
    expect(result.reason).toContain('sga');
  });

  test('returns insufficient-history rather than dividing by zero when revenue is 0 in either year', async () => {
    const fixtures = baseline(100, 100);
    fixtures.set(REVENUE_TAGS, years(2024, 0, 800));
    fixtureRepository(fixtures);
    const result = await computeBeneishMScore('0000000001');
    expect(result.status).toBe('insufficient-history');
  });
});

/**
 * Post-Phase 7 hardening, step 3 (F1b-2). Each figure used to be read as
 * "its own latest year" independently, so a company missing one figure for
 * its newest year had that figure's older year silently paired with every
 * other figure's newer one. Scores now use the most recent fiscal year that
 * EVERY figure has (and, for the two-year scores, the year immediately
 * before it) - and derive gross profit and SG&A where a company reports
 * their parts instead.
 */
describe('year alignment and derived figures', () => {
  const beneish = (overrides: Array<[string[], AnnualValue[] | undefined]> = []) => {
    const map = new Map<string[], AnnualValue[]>([
      [ASSETS_TAGS, years(2024, 1000, 1000)],
      [CURRENT_ASSETS_TAGS, years(2024, 300, 300)],
      [CURRENT_LIABILITIES_TAGS, years(2024, 200, 200)],
      [LONG_TERM_DEBT_TAGS, years(2024, 100, 100)],
      [OPERATING_CASH_FLOW_TAGS, years(2024, 100, 100)],
      [NET_INCOME_TAGS, years(2024, 100, 100)],
      [REVENUE_TAGS, years(2024, 800, 800)],
      [GROSS_PROFIT_TAGS, years(2024, 400, 400)],
      [RECEIVABLES_TAGS, years(2024, 80, 80)],
      [PPE_TAGS, years(2024, 200, 200)],
      [DEPRECIATION_TAGS, years(2024, 50, 50)],
      [SGA_TAGS, years(2024, 100, 100)],
    ]);
    for (const [tags, values] of overrides) {
      if (values === undefined) map.delete(tags);
      else map.set(tags, values);
    }
    return map;
  };

  test('Altman uses the newest year EVERY figure has - not assets from one year and EBIT from another', async () => {
    fixtureRepository(
      new Map<string[], AnnualValue[]>([
        [ASSETS_TAGS, years(2025, 5000, 1000)], // 2025 exists for assets only
        [CURRENT_ASSETS_TAGS, years(2024, 300)],
        [CURRENT_LIABILITIES_TAGS, years(2024, 200)],
        [RETAINED_EARNINGS_TAGS, years(2024, 100)],
        [OPERATING_INCOME_TAGS, years(2024, 150)],
        [STOCKHOLDERS_EQUITY_TAGS, years(2024, 400)],
        [LIABILITIES_TAGS, years(2024, 600)],
      ]),
    );

    const result = await computeAltmanZDoublePrime('1');

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.inputs.fiscalYear).toBe(2024);
    expect(result.inputs.totalAssets).toBe(1000);
  });

  test('Piotroski falls back to the newest pair of consecutive years that every figure has', async () => {
    const three = (a: number, b: number, c: number) => years(2025, a, b, c);
    fixtureRepository(
      new Map<string[], AnnualValue[]>([
        [ASSETS_TAGS, three(1000, 1000, 1000)],
        [CURRENT_ASSETS_TAGS, three(300, 300, 300)],
        [CURRENT_LIABILITIES_TAGS, three(200, 200, 200)],
        [LONG_TERM_DEBT_TAGS, three(100, 100, 100)],
        [OPERATING_CASH_FLOW_TAGS, three(100, 100, 100)],
        [NET_INCOME_TAGS, three(50, 50, 50)],
        [SHARES_OUTSTANDING_TAGS, years(2024, 10, 10)], // no 2025
        [GROSS_PROFIT_TAGS, three(400, 400, 400)],
        [REVENUE_TAGS, three(800, 800, 800)],
      ]),
    );

    const result = await computePiotroskiFScore('1');

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect([result.inputs.fiscalYearCurrent, result.inputs.fiscalYearPrior]).toEqual([2024, 2023]);
  });

  test('the two years must be consecutive', async () => {
    fixtureRepository(beneish([[REVENUE_TAGS, [{ fiscalYear: 2024, value: 800 }, { fiscalYear: 2022, value: 800 }]]]));

    const result = await computeBeneishMScore('1');

    expect(result).toEqual({ status: 'insufficient-history', reason: expect.stringContaining('consecutive') });
  });

  test('gross profit is derived as revenue minus cost of revenue when not reported', async () => {
    // Different margins in the two years: the score compares them as a ratio,
    // so identical years would hide a wrong derivation (a mutation check
    // caught exactly that). Revenue is 800 in both years.
    fixtureRepository(beneish([[GROSS_PROFIT_TAGS, years(2024, 400, 300)]]));
    const reported = await computeBeneishMScore('1');
    fixtureRepository(beneish([[GROSS_PROFIT_TAGS, undefined], [COST_OF_REVENUE_TAGS, years(2024, 400, 500)]]));

    const derived = await computeBeneishMScore('1');

    expect(derived.status).toBe('ok');
    if (derived.status !== 'ok' || reported.status !== 'ok') return;
    expect(derived.value).toBe(reported.value);
    expect(derived.inputs.derived).toEqual(['grossProfit']);
  });

  test('SG&A is derived as selling-and-marketing plus general-and-administrative when both are reported', async () => {
    fixtureRepository(beneish());
    const reported = await computeBeneishMScore('1');
    fixtureRepository(
      beneish([
        [SGA_TAGS, undefined],
        [SELLING_MARKETING_TAGS, years(2024, 60, 60)],
        [GENERAL_ADMIN_TAGS, years(2024, 40, 40)],
      ]),
    );

    const derived = await computeBeneishMScore('1');

    expect(derived.status).toBe('ok');
    if (derived.status !== 'ok' || reported.status !== 'ok') return;
    expect(derived.value).toBe(reported.value);
    expect(derived.inputs.derived).toEqual(['sga']);
  });

  test('general-and-administrative alone is NOT used as SG&A - it would understate it', async () => {
    fixtureRepository(beneish([[SGA_TAGS, undefined], [GENERAL_ADMIN_TAGS, years(2024, 40, 40)]]));

    const result = await computeBeneishMScore('1');

    expect(result).toEqual({ status: 'insufficient-history', reason: expect.stringContaining('sga') });
  });

  test('a reported figure always wins over one derived from its parts', async () => {
    fixtureRepository(beneish());
    const reportedOnly = await computeBeneishMScore('1');
    // The parts are ALSO reported, with values that would change the score.
    fixtureRepository(
      beneish([
        [COST_OF_REVENUE_TAGS, years(2024, 100, 700)],
        [SELLING_MARKETING_TAGS, years(2024, 10, 500)],
        [GENERAL_ADMIN_TAGS, years(2024, 10, 500)],
      ]),
    );

    const result = await computeBeneishMScore('1');

    expect(result.status === 'ok' && result.inputs.derived).toEqual([]);
    expect(result.status === 'ok' && reportedOnly.status === 'ok' && result.value).toBe(reportedOnly.status === 'ok' && reportedOnly.value);
  });
});
