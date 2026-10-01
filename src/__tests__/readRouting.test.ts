/**
 * Phase 7, step 2 - which database answers each read.
 *
 * The replica is asynchronous, so the thing that can go wrong is trusting a
 * replica that has not caught up yet. These tests pin the rules in
 * src/routes/companies.ts and src/riskFactorDiffService.ts:
 * - a replica hit is served from the replica, with no primary query;
 * - a replica miss is checked on the primary before anything expensive
 *   happens (an SEC fetch), or before answering "no diff stored";
 * - once a request has touched the primary, its follow-up reads stay there.
 *
 * `pool` and `readDb` are replaced by two labelled stand-ins, and each
 * repository read looks up its answer by which one it was handed - so every
 * assertion is about routing, and nothing connects anywhere.
 */
import { CompanyRecord } from '../repositories/companyRepository';

jest.mock('../db', () => ({
  pool: { label: 'primary' },
  readDb: { label: 'replica' },
}));
jest.mock('../repositories/companyRepository', () => ({
  getCompanyByCik: jest.fn(),
  getFactsByCik: jest.fn(),
  upsertCompanyFacts: jest.fn(),
}));
jest.mock('../repositories/riskFactorDiffRepository', () => ({
  getLatestRiskFactorDiff: jest.fn(),
  upsertRiskFactorDiff: jest.fn(),
}));
jest.mock('../riskFactorDiff', () => ({ diffRiskFactorFilings: jest.fn() }));

import { pool, readDb } from '../db';
import { getCompanyByCik, upsertCompanyFacts } from '../repositories/companyRepository';
import { getLatestRiskFactorDiff } from '../repositories/riskFactorDiffRepository';
import { getOrFetchCompany } from '../routes/companies';
import { getStoredRiskFactorDiff } from '../riskFactorDiffService';

const APPLE: CompanyRecord = { cik: '0000320193', entityName: 'Apple Inc.' };

type Label = 'primary' | 'replica';
const labelOf = (db: unknown): Label => (db as { label: Label }).label;

/** Makes a mocked repository read answer according to which database it was handed. */
function holdsOn<T>(fn: unknown, answers: Record<Label, T | null>) {
  (fn as jest.Mock).mockImplementation(async (_cik: string, db: unknown) => answers[labelOf(db)]);
}

/** The database each call was sent to, in order. */
function routedTo(fn: unknown): Label[] {
  return (fn as jest.Mock).mock.calls.map((call) => labelOf(call[1]));
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getOrFetchCompany', () => {
  test('a company the replica holds is served by the replica alone', async () => {
    holdsOn(getCompanyByCik, { replica: APPLE, primary: APPLE });

    const result = await getOrFetchCompany('320193');

    expect(result.company).toEqual(APPLE);
    expect(result.db).toBe(readDb);
    expect(routedTo(getCompanyByCik)).toEqual(['replica']);
    expect(upsertCompanyFacts).not.toHaveBeenCalled();
  });

  test('replication lag: a company on the primary but not yet on the replica is found there, with no SEC fetch', async () => {
    holdsOn(getCompanyByCik, { replica: null, primary: APPLE });

    const result = await getOrFetchCompany('320193');

    expect(result.company).toEqual(APPLE);
    // Follow-up reads (the facts) must use the primary too - the replica has
    // not caught up to this company.
    expect(result.db).toBe(pool);
    expect(routedTo(getCompanyByCik)).toEqual(['replica', 'primary']);
    expect(upsertCompanyFacts).not.toHaveBeenCalled();
  });

  test('a company held nowhere is fetched from SEC only after both databases miss, and read back from the primary', async () => {
    (getCompanyByCik as jest.Mock)
      .mockResolvedValueOnce(null) // replica
      .mockResolvedValueOnce(null) // primary
      .mockResolvedValueOnce(APPLE); // primary, after the upsert

    const result = await getOrFetchCompany('320193');

    expect(upsertCompanyFacts).toHaveBeenCalledTimes(1);
    expect(upsertCompanyFacts).toHaveBeenCalledWith('320193');
    // Read-after-write: the replica may not have the new row yet, so the read
    // back must not go there.
    expect(routedTo(getCompanyByCik)).toEqual(['replica', 'primary', 'primary']);
    expect(result).toEqual({ company: APPLE, db: pool });
  });
});

describe('getStoredRiskFactorDiff', () => {
  const STORED = { cik: '0000320193', currentAccn: 'a-2', priorAccn: 'a-1' };

  test('a diff the replica holds is served by the replica alone', async () => {
    holdsOn(getLatestRiskFactorDiff, { replica: STORED, primary: STORED });

    await expect(getStoredRiskFactorDiff('320193')).resolves.toBe(STORED);
    expect(routedTo(getLatestRiskFactorDiff)).toEqual(['replica']);
  });

  test('replication lag: a diff on the primary but not yet on the replica is still served', async () => {
    holdsOn(getLatestRiskFactorDiff, { replica: null, primary: STORED });

    await expect(getStoredRiskFactorDiff('320193')).resolves.toBe(STORED);
    expect(routedTo(getLatestRiskFactorDiff)).toEqual(['replica', 'primary']);
  });

  test('no diff on either database is null - nothing is computed on a request', async () => {
    holdsOn(getLatestRiskFactorDiff, { replica: null, primary: null });

    await expect(getStoredRiskFactorDiff('320193')).resolves.toBeNull();
    expect(routedTo(getLatestRiskFactorDiff)).toEqual(['replica', 'primary']);
  });
});
