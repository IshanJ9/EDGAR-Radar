/**
 * Post-Phase 7 hardening, step 3 (F1b) - annual facts are chosen by the
 * period they cover, not by the filing that reported them.
 *
 * In SEC's companyfacts data, `fy` is the fiscal year of the FILING. Each
 * 10-K restates earlier years - three years of income, two balance sheets -
 * and every one of those values carries the filing's `fy`. annualFacts used
 * to keep one value per `fy`, so production stored Apple's "fiscal 2025"
 * revenue as $383.3B: the year ended September 2023, from the comparative
 * column of the 2025 10-K. Apple's 2024 and 2025 revenue were never stored,
 * and every score paired mismatched, stale years.
 *
 * The fixtures below have the real shape: two 10-Ks, each restating prior
 * years under its own `fy`.
 */
import { annualFacts, UsGaapFact } from '../sec';

const TENK_2024 = { form: '10-K', fp: 'FY', fy: 2024, filed: '2024-11-01', accn: '0000320193-24-000123' };
const TENK_2025 = { form: '10-K', fp: 'FY', fy: 2025, filed: '2025-10-31', accn: '0000320193-25-000079' };

/** A full fiscal year of an income-statement item, as a given 10-K reports it. */
function year(filing: typeof TENK_2024, end: string, val: number): UsGaapFact {
  const start = new Date(Date.parse(end) - 363 * 86_400_000).toISOString().slice(0, 10);
  return { ...filing, start, end, val };
}
/** A balance-sheet value at a year end, as a given 10-K reports it. */
function at(filing: typeof TENK_2024, end: string, val: number): UsGaapFact {
  return { ...filing, end, val };
}

function companyFacts(tags: Record<string, UsGaapFact[]>, unit: 'USD' | 'shares' = 'USD') {
  return { facts: { 'us-gaap': Object.fromEntries(Object.entries(tags).map(([t, v]) => [t, { units: { [unit]: v } }])) } };
}

// Apple-shaped revenue: each 10-K reports three fiscal years.
const REVENUE = [
  year(TENK_2024, '2022-09-24', 394_328),
  year(TENK_2024, '2023-09-30', 383_285),
  year(TENK_2024, '2024-09-28', 391_035),
  year(TENK_2025, '2023-09-30', 383_285),
  year(TENK_2025, '2024-09-28', 391_035),
  year(TENK_2025, '2025-09-27', 416_161),
];

describe('annualFacts', () => {
  test('returns each fiscal year once, newest first, labelled by the year its period ends', () => {
    const result = annualFacts(companyFacts({ Revenues: REVENUE }), ['Revenues'], 'USD', 5);

    expect(result!.facts.map((f) => [f.end, f.fy, f.val])).toEqual([
      ['2025-09-27', 2025, 416_161],
      ['2024-09-28', 2024, 391_035],
      ['2023-09-30', 2023, 383_285],
      ['2022-09-24', 2022, 394_328],
    ]);
  });

  test('the latest two years are the latest two periods - the production bug', () => {
    const result = annualFacts(companyFacts({ Revenues: REVENUE }), ['Revenues'], 'USD', 2);

    expect(result!.facts.map((f) => f.end)).toEqual(['2025-09-27', '2024-09-28']);
  });

  test('balance-sheet values (no start date) work the same way', () => {
    const assets = [
      at(TENK_2024, '2023-09-30', 352_583),
      at(TENK_2024, '2024-09-28', 364_980),
      at(TENK_2025, '2024-09-28', 364_980),
      at(TENK_2025, '2025-09-27', 359_241),
    ];
    const result = annualFacts(companyFacts({ Assets: assets }), ['Assets'], 'USD', 5);

    expect(result!.facts.map((f) => [f.end, f.fy])).toEqual([
      ['2025-09-27', 2025],
      ['2024-09-28', 2024],
      ['2023-09-30', 2023],
    ]);
  });

  test('a restated figure: the most recently filed value for a period wins', () => {
    const restated = [year(TENK_2024, '2024-09-28', 100), year(TENK_2025, '2024-09-28', 120)];
    const result = annualFacts(companyFacts({ Revenues: restated }), ['Revenues'], 'USD', 1);

    expect(result!.facts[0]!.val).toBe(120);
  });

  test('a quarter reported inside a 10-K is not a year', () => {
    const withQuarter = [
      // Some filers report the fourth quarter in their 10-K, also tagged fp
      // "FY", with the same period end and filing date as the full year.
      // Listed FIRST: SEC's order is arbitrary, and after the full year it
      // would lose on ordering alone and prove nothing (a mutation check
      // caught exactly that).
      { ...TENK_2025, start: '2025-06-29', end: '2025-09-27', val: 102_466 },
      ...REVENUE,
    ];
    const result = annualFacts(companyFacts({ Revenues: withQuarter }), ['Revenues'], 'USD', 1);

    expect(result!.facts[0]!.val).toBe(416_161);
  });

  test('10-Q values are never annual', () => {
    const quarterly = [...REVENUE, { form: '10-Q', fp: 'Q3', fy: 2026, filed: '2026-07-31', accn: 'q', start: '2025-09-28', end: '2026-06-27', val: 999 }];
    const result = annualFacts(companyFacts({ Revenues: quarterly }), ['Revenues'], 'USD', 1);

    expect(result!.facts[0]!.end).toBe('2025-09-27');
  });

  test('prefers the tag with the freshest data, not the first tag that has any', () => {
    // A company stopped using `LongTermDebt` years ago (JPMorgan's stored
    // long-term debt was from 2011-2012) and reports `LongTermDebtNoncurrent` now.
    const data = companyFacts({
      LongTermDebt: [at(TENK_2024, '2011-12-31', 1), at(TENK_2024, '2012-12-31', 2)],
      LongTermDebtNoncurrent: [at(TENK_2025, '2024-09-28', 85_750), at(TENK_2025, '2025-09-27', 78_328)],
    });
    const result = annualFacts(data, ['LongTermDebt', 'LongTermDebtNoncurrent'], 'USD', 5);

    expect(result!.tag).toBe('LongTermDebtNoncurrent');
    expect(result!.facts.map((f) => f.end)).toEqual(['2025-09-27', '2024-09-28']);
  });

  test('when two tags are equally fresh, the earlier tag in priority order wins', () => {
    const data = companyFacts({
      Revenues: [year(TENK_2025, '2024-09-28', 1), year(TENK_2025, '2025-09-27', 2)],
      SalesRevenueNet: [year(TENK_2025, '2024-09-28', 3), year(TENK_2025, '2025-09-27', 4)],
    });
    expect(annualFacts(data, ['Revenues', 'SalesRevenueNet'], 'USD', 5)!.tag).toBe('Revenues');
  });

  test('a tag needs at least two years (what a score compares) unless fewer are asked for', () => {
    const oneYear = companyFacts({ Revenues: [year(TENK_2025, '2025-09-27', 1)] });
    expect(annualFacts(oneYear, ['Revenues'], 'USD', 5)).toBeNull();
    expect(annualFacts(oneYear, ['Revenues'], 'USD', 1)!.facts).toHaveLength(1);
  });

  test('maxFiscalYear limits by the period, for back-testing', () => {
    const result = annualFacts(companyFacts({ Revenues: REVENUE }), ['Revenues'], 'USD', 2, 2023);

    expect(result!.facts.map((f) => f.end)).toEqual(['2023-09-30', '2022-09-24']);
  });

  test('never mutates the caller’s data', () => {
    const data = companyFacts({ Revenues: REVENUE.map((f) => ({ ...f })) });
    annualFacts(data, ['Revenues'], 'USD', 5);
    expect(data.facts['us-gaap'].Revenues!.units.USD!.map((f) => f.fy)).toEqual([2024, 2024, 2024, 2025, 2025, 2025]);
  });
});
