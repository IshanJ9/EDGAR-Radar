/**
 * Post-Phase 7 hardening, step 3 (F1c) - the parser worker computes a
 * company's risk-factor diff when it stores a new 10-K's text, so the API
 * never has to. Everything outside processFilingDiscovered is mocked.
 */
jest.mock('../companyIngestion', () => ({ attemptCompanyIngestion: jest.fn() }));
jest.mock('../repositories/filingTextRepository', () => ({ ingestFilingText: jest.fn() }));
jest.mock('../repositories/stageCompletionRepository', () => ({ claimStage: jest.fn() }));
jest.mock('../queues', () => ({ filingParsedQueue: { add: jest.fn() } }));
jest.mock('../riskFactorDiffService', () => ({ computeLatestRiskFactorDiff: jest.fn() }));

import { Job } from 'bullmq';
import { attemptCompanyIngestion } from '../companyIngestion';
import { ingestFilingText } from '../repositories/filingTextRepository';
import { claimStage } from '../repositories/stageCompletionRepository';
import { filingParsedQueue, FilingDiscoveredJobData } from '../queues';
import { computeLatestRiskFactorDiff } from '../riskFactorDiffService';
import { processFilingDiscovered } from '../parserWorker';

const job = (form: string) =>
  ({
    data: { cik: '0000320193', ticker: 'AAPL', accessionNumber: 'k-2026', form, filingDate: '2026-10-30', primaryDocument: 'aapl.htm' },
  }) as Job<FilingDiscoveredJobData>;

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(attemptCompanyIngestion).mockResolvedValue({ status: 'success' } as never);
  jest.mocked(ingestFilingText).mockResolvedValue({} as never);
  jest.mocked(claimStage).mockResolvedValue(true);
  jest.mocked(computeLatestRiskFactorDiff).mockResolvedValue({ status: 'computed', currentAccn: 'k-2026', priorAccn: 'k-2025' });
});

describe('processFilingDiscovered - risk-factor diffs', () => {
  test("a 10-K whose text was stored has the company's diff computed", async () => {
    await processFilingDiscovered(job('10-K'));

    expect(computeLatestRiskFactorDiff).toHaveBeenCalledWith('0000320193');
    expect(jest.mocked(computeLatestRiskFactorDiff).mock.invocationCallOrder[0]!).toBeGreaterThan(
      jest.mocked(ingestFilingText).mock.invocationCallOrder[0]!,
    );
  });

  test('any other form does not', async () => {
    await processFilingDiscovered(job('10-Q'));

    expect(computeLatestRiskFactorDiff).not.toHaveBeenCalled();
  });

  test("a 10-K whose text failed to download does not - there is nothing new to compare", async () => {
    jest.mocked(ingestFilingText).mockRejectedValue(new Error('HTTP 503'));

    await processFilingDiscovered(job('10-K'));

    expect(computeLatestRiskFactorDiff).not.toHaveBeenCalled();
  });

  test('a failed diff does not fail the filing: it is still passed on to scoring', async () => {
    jest.mocked(computeLatestRiskFactorDiff).mockRejectedValue(new Error('HTTP 503'));

    await expect(processFilingDiscovered(job('10-K'))).resolves.toBeUndefined();

    expect(filingParsedQueue.add).toHaveBeenCalledWith('filing-parsed', expect.objectContaining({ accessionNumber: 'k-2026', textIngested: true }));
  });
});

// Post-Phase 7 hardening, step 4: a companyfacts download (several MB, one
// request of the parser's SEC share) only for filings that change the facts.
describe('processFilingDiscovered - which filings refresh the financial facts', () => {
  test.each(['10-K', '10-Q', '10-K/A'])('a %s refreshes them', async (form) => {
    await processFilingDiscovered(job(form));

    expect(attemptCompanyIngestion).toHaveBeenCalledWith('0000320193');
    expect(filingParsedQueue.add).toHaveBeenCalledWith('filing-parsed', expect.objectContaining({ factsRefreshed: true }));
  });

  test.each(['424B2', 'FWP', '4', '8-K'])('a %s does not - no SEC download - but is still passed on to scoring', async (form) => {
    await processFilingDiscovered(job(form));

    expect(attemptCompanyIngestion).not.toHaveBeenCalled();
    expect(filingParsedQueue.add).toHaveBeenCalledWith('filing-parsed', expect.objectContaining({ form, factsRefreshed: false }));
  });
});
