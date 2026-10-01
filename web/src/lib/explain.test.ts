import { describe, expect, test } from 'vitest';
import {
  altmanBand,
  altmanReasons,
  beneishBand,
  beneishReasons,
  derivedNotes,
  formatMoney,
  formatScore,
  isFinancialCompany,
  piotroskiBand,
  piotroskiChecks,
  summarize,
  unscoredReason,
} from './explain';

describe('formatMoney', () => {
  test('uses billions, millions and trillions with one decimal, and a real minus sign', () => {
    expect(formatMoney(416_161_000_000)).toBe('$416.2B');
    expect(formatMoney(-14_264_000_000)).toBe('−$14.3B');
    expect(formatMoney(2_500_000)).toBe('$2.5M');
    expect(formatMoney(3_100_000_000_000)).toBe('$3.1T');
    expect(formatMoney(950_000)).toBe('$950K');
  });
});

describe('formatScore', () => {
  test('rounds half away from zero, as people do - toFixed alone gives 2.29 for 2.295, stored as 2.29499…', () => {
    expect(formatScore(-2.295)).toBe('−2.30');
    expect(formatScore(2.308)).toBe('2.31');
    expect(formatScore(4.46)).toBe('4.46');
    expect(formatScore(-0.343)).toBe('−0.34');
  });

  test('also when the scaling itself lands just below a half (1.005 × 100 is 100.49999…)', () => {
    expect(formatScore(1.005)).toBe('1.01');
    expect(formatScore(-0.285)).toBe('−0.29');
  });
});

describe('Altman Z″ - bankruptcy risk', () => {
  test('bands in plain English, with a position on a 0-4 gauge', () => {
    expect(altmanBand('safe', 4.46)).toMatchObject({ label: 'Safe', tone: 'good' });
    expect(altmanBand('grey-zone', 2.308)).toMatchObject({ label: 'Caution', tone: 'warning' });
    expect(altmanBand('distress', -0.343)).toMatchObject({ label: 'High risk', tone: 'critical' });
    expect(altmanBand('grey-zone', 2).position).toBeCloseTo(0.5);
    expect(altmanBand('distress', -3).position).toBe(0);
    expect(altmanBand('safe', 9).position).toBe(1);
  });

  test('explains the score from its inputs', () => {
    const reasons = altmanReasons({ workingCapital: -17_674_000_000, retainedEarnings: -14_264_000_000, ebit: 133_050_000_000 });

    expect(reasons).toEqual([
      'Short-term debts exceed short-term assets by $17.7B.',
      'Retained earnings are −$14.3B - usually years of buybacks or dividends, or past losses.',
      'Operating profit of $133.1B pulls the score up.',
    ]);
  });

  test('the positive versions read the other way round', () => {
    expect(altmanReasons({ workingCapital: 5_949_000_000, retainedEarnings: 46_891_000_000, ebit: -1_000_000_000 })).toEqual([
      'Short-term assets exceed short-term debts by $5.9B.',
      'It has kept $46.9B of past profits in the business.',
      'An operating loss of $1.0B pulls the score down.',
    ]);
  });
});

describe('Piotroski F - financial strength', () => {
  test('bands', () => {
    expect(piotroskiBand('high-quality').label).toBe('Strong');
    expect(piotroskiBand('moderate').label).toBe('Moderate');
    expect(piotroskiBand('low-quality').label).toBe('Weak');
  });

  test('the nine checks in plain English, passed first, in a fixed order', () => {
    const checks = piotroskiChecks({
      positiveROA: true,
      positiveCFO: true,
      improvingROA: true,
      cfoExceedsNetIncome: false,
      decreasingLeverage: true,
      improvingCurrentRatio: true,
      noNewShares: true,
      improvingGrossMargin: true,
      improvingAssetTurnover: true,
    });

    expect(checks).toHaveLength(9);
    expect(checks[0]).toEqual({ label: 'Profitable', passed: true });
    expect(checks.at(-1)).toEqual({ label: 'Cash beats reported profit', passed: false });
  });
});

describe('Beneish M - accounting red flags', () => {
  test('bands, with a position on a -4 to -1 gauge', () => {
    expect(beneishBand('unlikely-manipulator', -2.295)).toMatchObject({ label: 'None found', tone: 'good' });
    expect(beneishBand('likely-manipulator', -1.5)).toMatchObject({ label: 'Worth a closer look', tone: 'serious' });
    expect(beneishBand('unlikely-manipulator', -2.5).position).toBeCloseTo(0.5);
  });

  test('names the measures that moved like those of companies later caught manipulating earnings', () => {
    expect(beneishReasons({ dsri: 1.6, gmi: 0.98, aqi: 0.99, sgi: 1.7, depi: 1.05, sgai: 0.99, tata: 0.0015, lvgi: 0.94 })).toEqual([
      'Customers are taking much longer to pay.',
      'Sales grew unusually fast.',
    ]);
  });

  test('says so plainly when nothing stands out', () => {
    expect(beneishReasons({ dsri: 1.1187, gmi: 0.9851, aqi: 0.9863, sgi: 1.0643, depi: 1.0539, sgai: 0.9938, tata: 0.0015, lvgi: 0.9455 })).toEqual([
      'Sales, margins, spending and debt all moved within normal ranges year over year.',
    ]);
  });
});

describe('figures we calculated rather than read', () => {
  test('are spelled out', () => {
    expect(derivedNotes(['grossProfit', 'sga'], true)).toEqual([
      "Gross profit is revenue minus cost of revenue - the company doesn't report it directly.",
      'Overhead (SG&A) is selling and marketing plus general and administrative costs.',
      "Total liabilities are total assets minus shareholders' equity.",
    ]);
    expect(derivedNotes([], false)).toEqual([]);
  });
});

describe('unscoredReason', () => {
  test('turns the missing figures into plain words', () => {
    expect(unscoredReason('Missing most-recent-fiscal-year data for: currentAssets, currentLiabilities, ebit.')).toBe(
      "Not enough figures to calculate it: short-term assets, short-term debts and operating profit aren't reported.",
    );
    expect(unscoredReason('Need 2 fiscal years of data; missing for: grossProfit.')).toBe(
      "It compares two years, and gross profit isn't reported for both yet.",
    );
  });

  test('names every figure key the scoring code uses - none leaks through as a code name (found live: "cfo")', () => {
    const keys = ['assets', 'cfo', 'currentAssets', 'currentLiabilities', 'depreciation', 'ebit', 'equity', 'grossProfit', 'liabilities', 'longTermDebt', 'netIncome', 'ppe', 'receivables', 'retainedEarnings', 'revenue', 'sga', 'shares'];
    for (const key of keys) {
      // No camelCase word and no abbreviation: what a visitor reads is English.
      expect(unscoredReason(`Missing most-recent-fiscal-year data for: ${key}.`)).not.toMatch(/\b(cfo|ppe|sga|ebit|[a-z]+[A-Z]\w*)\b/);
    }
    expect(unscoredReason('Missing most-recent-fiscal-year data for: cfo.')).toContain('cash from operations');
  });

  test('a long list of missing figures is summarised rather than read out (ExxonMobil Holdings: 12 missing)', () => {
    expect(unscoredReason('Missing most-recent-fiscal-year data for: assets, liabilities, currentAssets, currentLiabilities, retainedEarnings, ebit, equity.')).toBe(
      "Not enough figures to calculate it: most of what it needs isn't reported yet.",
    );
    expect(unscoredReason('Need 2 fiscal years of data; missing for: assets, currentAssets, currentLiabilities, longTermDebt, cfo.')).toBe(
      "It compares two years, and most of what it needs isn't reported for both yet.",
    );
  });

  test('explains years that do not line up', () => {
    expect(unscoredReason('No two consecutive fiscal years are available for every figure (assets 2025/2024; ...).')).toBe(
      "The company's figures don't cover the same two consecutive years yet.",
    );
  });

  test('explains a single year that no figure set shares (the Altman score)', () => {
    expect(unscoredReason('No single fiscal year is available for every figure (assets 2025/2024; ebit 2012/2011).')).toBe(
      "The company's latest figures don't all cover the same year yet.",
    );
  });

  test('falls back to a general sentence for anything else', () => {
    expect(unscoredReason('Something new')).toBe('Not enough figures to calculate it yet.');
  });
});

describe('isFinancialCompany', () => {
  test('recognises banks, insurers, brokers and property trusts by their SEC industry', () => {
    for (const industry of ['National Commercial Banks', 'Fire, Marine & Casualty Insurance', 'Security Brokers, Dealers & Flotation Companies', 'Real Estate Investment Trusts']) {
      expect(isFinancialCompany(industry)).toBe(true);
    }
    expect(isFinancialCompany('Electronic Computers')).toBe(false);
    expect(isFinancialCompany(null)).toBe(false);
  });
});

describe('summarize - the "In short" sentence', () => {
  test('joins the three verdicts into one sentence', () => {
    expect(
      summarize('Apple Inc.', {
        altman: { classification: 'grey-zone' },
        piotroski: { classification: 'high-quality', value: 8 },
        beneish: { classification: 'unlikely-manipulator' },
      }),
    ).toBe('Apple Inc. passes 8 of 9 financial-strength checks and shows no accounting red flags, but its bankruptcy-risk score is in the caution zone.');
  });

  test('all good', () => {
    expect(
      summarize('Danaher Corp', {
        altman: { classification: 'safe' },
        piotroski: { classification: 'moderate', value: 5 },
        beneish: { classification: 'unlikely-manipulator' },
      }),
    ).toBe('Danaher Corp has low bankruptcy risk, passes 5 of 9 financial-strength checks and shows no accounting red flags.');
  });

  test('only what was scored', () => {
    expect(summarize('AT&T Inc.', { altman: { classification: 'distress' } })).toBe('AT&T Inc. has a bankruptcy-risk score in the high-risk zone.');
    expect(summarize('JPMorgan Chase & Co', {})).toBeNull();
  });
});
