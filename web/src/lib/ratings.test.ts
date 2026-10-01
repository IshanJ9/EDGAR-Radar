import { describe, expect, test } from 'vitest';
import type { Company } from './api';
import { coverage, hasConcern, ratingChip, scoredCount } from './ratings';

const company = (ratings: Company['ratings'], industry: string | null = null): Company => ({
  cik: '1',
  ticker: 'X',
  name: 'X',
  displayName: 'X',
  industry,
  ratings,
});
const ok = (value: number, classification: string) => ({ status: 'ok' as const, value, classification });
const none = { status: 'insufficient-history' as const };

describe('ratingChip', () => {
  test('each score as a short verdict and its number', () => {
    expect(ratingChip('altmanZ', ok(2.308, 'grey-zone'))).toEqual({ label: 'Caution', tone: 'warning', value: '2.31' });
    expect(ratingChip('piotroskiF', ok(8, 'high-quality'))).toEqual({ label: 'Strong', tone: 'good', value: '8/9' });
    expect(ratingChip('beneishM', ok(-1.5, 'likely-manipulator'))).toEqual({ label: 'Look closer', tone: 'serious', value: '−1.50' });
  });

  test('a missing score is null', () => {
    expect(ratingChip('altmanZ', none)).toBeNull();
    expect(ratingChip('altmanZ', undefined)).toBeNull();
  });
});

describe('scoredCount and hasConcern', () => {
  test('counts the scores a company has', () => {
    expect(scoredCount(company({ altmanZ: ok(3, 'safe'), piotroskiF: ok(8, 'high-quality'), beneishM: ok(-2.5, 'unlikely-manipulator') }))).toBe(3);
    expect(scoredCount(company({ altmanZ: ok(3, 'safe'), piotroskiF: none, beneishM: none }))).toBe(1);
  });

  test('a concern is caution or high risk, weak strength, or an accounting flag', () => {
    expect(hasConcern(company({ altmanZ: ok(2, 'grey-zone') }))).toBe(true);
    expect(hasConcern(company({ piotroskiF: ok(2, 'low-quality') }))).toBe(true);
    expect(hasConcern(company({ beneishM: ok(-1.5, 'likely-manipulator') }))).toBe(true);
    expect(hasConcern(company({ altmanZ: ok(3, 'safe'), piotroskiF: ok(5, 'moderate'), beneishM: ok(-2.5, 'unlikely-manipulator') }))).toBe(false);
  });
});

describe('coverage', () => {
  test('how many companies have all three scores, and how many none', () => {
    const all = company({ altmanZ: ok(3, 'safe'), piotroskiF: ok(8, 'high-quality'), beneishM: ok(-2.5, 'unlikely-manipulator') });
    const nothing = company({ altmanZ: none, piotroskiF: none, beneishM: none });
    expect(coverage([all, all, nothing, company({ altmanZ: ok(3, 'safe') })])).toEqual({ total: 4, allThree: 2, none: 1 });
  });
});
