/**
 * Phase 7, step 3 - invalidation at the write points. Every write to the
 * tables behind the cached endpoints goes through these three repository
 * functions, so these tests are what stands between a new filing and a stale
 * cached response. The database and the cache are both mocked; the order of
 * calls is checked, because deleting a key before the write lands would let a
 * concurrent read re-cache the old data.
 */
jest.mock('../db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../cache', () => ({
  cacheKeys: jest.requireActual('../cache').cacheKeys,
  responseCache: { invalidate: jest.fn() },
}));
jest.mock('../sec', () => ({
  ...jest.requireActual('../sec'),
  fetchCompanyFacts: jest.fn(),
}));

import { pool } from '../db';
import { cacheKeys, responseCache } from '../cache';
import { fetchCompanyFacts, UsGaapFact } from '../sec';
import { upsertCompanyFacts, upsertFact } from '../repositories/companyRepository';
import { upsertRiskFactorDiff } from '../repositories/riskFactorDiffRepository';

const query = pool.query as jest.Mock;
const invalidate = responseCache.invalidate as jest.Mock;

const VALID_FACT: UsGaapFact = {
  end: '2024-09-28',
  val: 391035000000,
  fy: 2024,
  fp: 'FY',
  form: '10-K',
  filed: '2024-11-01',
  accn: '0000320193-24-000123',
};

beforeEach(() => {
  jest.clearAllMocks();
  query.mockResolvedValue({ rows: [] });
  invalidate.mockResolvedValue(undefined);
});

/** True if every call to `later` happened after the last call to `earlier`. */
function calledAfter(later: jest.Mock, earlier: jest.Mock): boolean {
  const lastEarlier = Math.max(...earlier.mock.invocationCallOrder);
  return later.mock.invocationCallOrder.every((order) => order > lastEarlier);
}

describe('upsertFact', () => {
  test("invalidates the company's facts, scores and financials, after the row is written - but not the 196-company list", async () => {
    await upsertFact('0000320193', 'Revenues', VALID_FACT);

    // Clearing the list on every fact write kept it permanently cold in
    // production: the parser worker writes facts for every filing it
    // processes, so the list (1.5-2.2 s to rebuild) was cleared every few
    // seconds on a busy day. It expires with the TTL instead.
    expect(invalidate).toHaveBeenCalledWith(cacheKeys.facts('0000320193'), cacheKeys.scores('0000320193'), cacheKeys.financials('0000320193'));
    expect(calledAfter(invalidate, query)).toBe(true);
  });

  test('a quarantined fact changes no cached table, so it invalidates nothing', async () => {
    await upsertFact('0000320193', 'Revenues', { ...VALID_FACT, val: Number.NaN });

    expect(query.mock.calls[0]![0]).toContain('quarantined_facts');
    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe('upsertCompanyFacts', () => {
  // The company's name appears in both bodies, so writing the company row
  // must clear both - not only the company endpoint's.
  test('invalidates both the company and the facts responses when it writes the company', async () => {
    (fetchCompanyFacts as jest.Mock).mockResolvedValue({ cik: 320193, entityName: 'Apple Inc.', facts: {} });

    await upsertCompanyFacts('320193');

    expect(invalidate).toHaveBeenCalledWith(cacheKeys.company('0000320193'), cacheKeys.facts('0000320193'));
    const companyWrite = query.mock.calls.findIndex(([sql]) => String(sql).includes('INSERT INTO companies'));
    expect(query.mock.invocationCallOrder[companyWrite]!).toBeLessThan(invalidate.mock.invocationCallOrder[0]!);
  });

  // Post-Phase 7 hardening, step 3 (F1b-2): scoring derives gross profit and
  // SG&A from these when a company reports no combined figure, so ingestion
  // has to store them.
  test('stores cost of revenue and both SG&A components, the parts scoring derives from', async () => {
    const twoYears = (tag: string) => ({
      [tag]: {
        units: {
          USD: [
            { ...VALID_FACT, start: '2023-10-01', end: '2024-09-28', val: 100 },
            { ...VALID_FACT, start: '2022-09-25', end: '2023-09-30', val: 90 },
          ],
        },
      },
    });
    (fetchCompanyFacts as jest.Mock).mockResolvedValue({
      cik: 320193,
      entityName: 'Apple Inc.',
      facts: {
        'us-gaap': {
          ...twoYears('CostOfGoodsAndServicesSold'),
          ...twoYears('SellingAndMarketingExpense'),
          ...twoYears('GeneralAndAdministrativeExpense'),
        },
      },
    });

    await upsertCompanyFacts('320193');

    const storedTags = query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO filing_facts')).map(([, params]) => params[1]);
    expect(new Set(storedTags)).toEqual(new Set(['CostOfGoodsAndServicesSold', 'SellingAndMarketingExpense', 'GeneralAndAdministrativeExpense']));
  });
});

describe('upsertRiskFactorDiff', () => {
  test('invalidates the risk-factor-diff response, after the row is written', async () => {
    const result = { summary: {}, chunks: [] } as unknown as Parameters<typeof upsertRiskFactorDiff>[5];

    await upsertRiskFactorDiff('320193', 'a-2', '2025-11-01', 'a-1', '2024-11-01', result);

    expect(invalidate).toHaveBeenCalledWith(cacheKeys.riskFactorDiff('0000320193'));
    expect(calledAfter(invalidate, query)).toBe(true);
  });
});
