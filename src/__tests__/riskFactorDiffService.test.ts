/**
 * Post-Phase 7 hardening, step 3 (F1c) - risk-factor diffs are computed when
 * a 10-K arrives (by the parser worker, or the one-off backfill), never by a
 * visitor's request. These pin what `computeLatestRiskFactorDiff` does with
 * SEC and the database: which filings it compares, which it downloads, and
 * when it does nothing at all. SEC, the database and the embedding model are
 * all mocked.
 */
jest.mock('../sec', () => ({
  ...jest.requireActual('../sec'),
  fetchSubmissions: jest.fn(),
}));
jest.mock('../repositories/filingTextRepository', () => ({
  ingestFilingText: jest.fn(),
  getFilingTextsByAccn: jest.fn(),
}));
jest.mock('../repositories/riskFactorDiffRepository', () => ({
  getLatestRiskFactorDiff: jest.fn(),
  hasRiskFactorDiff: jest.fn(),
  upsertRiskFactorDiff: jest.fn(),
}));
jest.mock('../riskFactorDiff', () => ({ diffRiskFactorFilings: jest.fn() }));
jest.mock('../db', () => ({ pool: { label: 'primary' }, readDb: { label: 'replica' } }));

import { fetchSubmissions, SecSubmissions, SubmissionsNotFoundError } from '../sec';
import { ingestFilingText, getFilingTextsByAccn } from '../repositories/filingTextRepository';
import { hasRiskFactorDiff, upsertRiskFactorDiff } from '../repositories/riskFactorDiffRepository';
import { diffRiskFactorFilings } from '../riskFactorDiff';
import { computeLatestRiskFactorDiff } from '../riskFactorDiffService';

const RESULT = { summary: { added: 1, removed: 0, modified: 0, unchanged: 3 }, chunks: [] } as never;

/** A submissions document listing these filings, newest first, as SEC orders them. */
function submissions(filings: Array<[accn: string, form: string, date: string]>): SecSubmissions {
  return {
    filings: {
      recent: {
        accessionNumber: filings.map(([a]) => a),
        form: filings.map(([, f]) => f),
        filingDate: filings.map(([, , d]) => d),
        primaryDocument: filings.map(([a]) => `${a}.htm`),
      },
    },
  } as unknown as SecSubmissions;
}

const TWO_10KS = submissions([
  ['k-2025', '10-K', '2025-10-31'],
  ['q-2025', '10-Q', '2025-08-01'],
  ['k-2024', '10-K', '2024-11-01'],
  ['k-2023', '10-K', '2023-11-03'],
]);

/** Which filings' text is already stored. */
function stored(...accns: string[]) {
  jest.mocked(getFilingTextsByAccn).mockReset();
  jest.mocked(getFilingTextsByAccn).mockImplementation(async (_cik, wanted) => {
    return new Map(wanted.map((a) => [a, { accn: a, filingDate: '', content: `text of ${a}` }]));
  });
  const have = new Set(accns);
  // Before ingestion, only `accns` exist; after, everything asked for does.
  jest.mocked(getFilingTextsByAccn).mockImplementationOnce(async (_cik, wanted) => {
    return new Map(wanted.filter((a) => have.has(a)).map((a) => [a, { accn: a, filingDate: '', content: `text of ${a}` }]));
  });
}

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(fetchSubmissions).mockResolvedValue(TWO_10KS);
  jest.mocked(hasRiskFactorDiff).mockResolvedValue(false);
  jest.mocked(diffRiskFactorFilings).mockResolvedValue(RESULT);
  stored();
});

describe('computeLatestRiskFactorDiff', () => {
  test("compares the company's two most recent 10-Ks - older first - and stores the result", async () => {
    const outcome = await computeLatestRiskFactorDiff('320193');

    expect(outcome.status).toBe('computed');
    expect(diffRiskFactorFilings).toHaveBeenCalledWith('text of k-2024', 'text of k-2025');
    expect(upsertRiskFactorDiff).toHaveBeenCalledWith('0000320193', 'k-2025', '2025-10-31', 'k-2024', '2024-11-01', RESULT);
  });

  test('downloads only the 10-Ks whose text is not stored yet', async () => {
    // The parser worker has just stored the new 10-K; only last year's is missing.
    stored('k-2025');

    await computeLatestRiskFactorDiff('320193');

    expect(ingestFilingText).toHaveBeenCalledTimes(1);
    expect(jest.mocked(ingestFilingText).mock.calls[0]![1]).toMatchObject({ accessionNumber: 'k-2024', form: '10-K' });
  });

  test('downloads nothing when both texts are stored', async () => {
    stored('k-2025', 'k-2024');

    await computeLatestRiskFactorDiff('320193');

    expect(ingestFilingText).not.toHaveBeenCalled();
  });

  test('does nothing - no download, no embedding - when this pair is already compared', async () => {
    jest.mocked(hasRiskFactorDiff).mockResolvedValue(true);

    const outcome = await computeLatestRiskFactorDiff('320193');

    expect(outcome.status).toBe('already-stored');
    expect(hasRiskFactorDiff).toHaveBeenCalledWith('0000320193', 'k-2025', 'k-2024');
    expect(ingestFilingText).not.toHaveBeenCalled();
    expect(diffRiskFactorFilings).not.toHaveBeenCalled();
    expect(upsertRiskFactorDiff).not.toHaveBeenCalled();
  });

  test('a company with fewer than two 10-Ks has not enough history', async () => {
    jest.mocked(fetchSubmissions).mockResolvedValue(submissions([['k-2025', '10-K', '2025-10-31'], ['q', '10-Q', '2025-08-01']]));

    const outcome = await computeLatestRiskFactorDiff('320193');

    expect(outcome.status).toBe('not-enough-history');
    expect(diffRiskFactorFilings).not.toHaveBeenCalled();
  });

  test('a CIK SEC does not know has not enough history', async () => {
    jest.mocked(fetchSubmissions).mockRejectedValue(new SubmissionsNotFoundError('404'));

    await expect(computeLatestRiskFactorDiff('1')).resolves.toMatchObject({ status: 'not-enough-history' });
  });

  test('a Risk Factors section that cannot be extracted stores nothing', async () => {
    jest.mocked(diffRiskFactorFilings).mockResolvedValue(null);

    const outcome = await computeLatestRiskFactorDiff('320193');

    expect(outcome.status).toBe('not-extractable');
    expect(upsertRiskFactorDiff).not.toHaveBeenCalled();
  });

  test('any other SEC failure propagates - it is not "not enough history"', async () => {
    jest.mocked(fetchSubmissions).mockRejectedValue(new Error('HTTP 503'));

    await expect(computeLatestRiskFactorDiff('320193')).rejects.toThrow('HTTP 503');
  });
});
