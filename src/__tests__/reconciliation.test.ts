/**
 * Post-Phase 7, step 2 - reconciliation against a database that does not yet
 * hold every universe company.
 *
 * Reconciliation corrects stored facts from SEC's bulk archive. Before this
 * change it also tried to write facts for companies with no `companies` row,
 * which filing_facts' foreign key rejects - failing the whole run. Production
 * held 2 of the 196 universe companies when the poller was first deployed, so
 * every nightly run there would have failed. The bulk download, the database
 * and the universe are all mocked; nothing connects anywhere.
 */
jest.mock('../universe', () => ({
  findProjectRoot: () => '/project',
  loadUniverse: () => [
    { cik: '320193', ticker: 'AAPL', name: 'Apple Inc.' },
    { cik: '789019', ticker: 'MSFT', name: 'Microsoft Corp' },
  ],
}));
// The cache directory "exists", so reconciliation skips creating it - it does
// that with a dynamic `import('fs')`, which Node runs fine but Jest's module
// system cannot. Deleting the (never-downloaded) zip is mocked out too.
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(() => true),
  mkdirSync: jest.fn(),
  unlinkSync: jest.fn(),
}));
jest.mock('../bulkData', () => ({
  downloadBulkCompanyFacts: jest.fn(),
  forEachCompanyFacts: jest.fn(),
}));
jest.mock('../repositories/companyRepository', () => ({
  getCompanyByCik: jest.fn(),
  getFactsByCik: jest.fn(),
  upsertFact: jest.fn(),
}));
jest.mock('../repositories/reconciliationRepository', () => ({
  startReconciliationRun: jest.fn(async () => 1),
  completeReconciliationRun: jest.fn(),
  failReconciliationRun: jest.fn(),
}));

import { forEachCompanyFacts } from '../bulkData';
import { getCompanyByCik, getFactsByCik, upsertFact } from '../repositories/companyRepository';
import { completeReconciliationRun, failReconciliationRun } from '../repositories/reconciliationRepository';
import { runReconciliation } from '../reconciliation';

/** The slice of SEC's companyfacts JSON that reconciliation reads. */
function bulkFactsWithRevenue(value: number) {
  return {
    facts: {
      'us-gaap': {
        Revenues: { units: { USD: [{ end: '2024-09-28', val: value, fy: 2024, fp: 'FY', form: '10-K', filed: '2024-11-01', accn: 'a-1' }] } },
      },
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  // Both universe companies are in the bulk archive; only Apple is stored.
  (forEachCompanyFacts as jest.Mock).mockImplementation(async (_zip: string, ciks: string[], onCompany: (cik: string, facts: unknown) => Promise<void>) => {
    for (const cik of ciks) await onCompany(cik.padStart(10, '0'), bulkFactsWithRevenue(391035000000));
    return { found: ciks.length, missing: [] };
  });
  (getCompanyByCik as jest.Mock).mockImplementation(async (cik: string) => (cik === '0000320193' ? { cik, entityName: 'Apple Inc.' } : null));
  (getFactsByCik as jest.Mock).mockResolvedValue([]); // Apple's stored revenue is missing -> one discrepancy
});

test('a company not stored yet is skipped and counted, and the run still completes', async () => {
  const result = await runReconciliation();

  expect(result.companiesNotStored).toBe(1);
  expect(completeReconciliationRun).toHaveBeenCalled();
  expect(failReconciliationRun).not.toHaveBeenCalled();
});

test('nothing is written for the unstored company - that insert is what used to fail the run', async () => {
  await runReconciliation();

  const writtenCiks = (upsertFact as jest.Mock).mock.calls.map(([cik]) => cik);
  expect(writtenCiks).not.toContain('0000789019');
  expect(getFactsByCik).not.toHaveBeenCalledWith('0000789019');
});

test('a stored company is still reconciled as before', async () => {
  const result = await runReconciliation();

  expect(upsertFact).toHaveBeenCalledWith('0000320193', 'Revenues', expect.objectContaining({ val: 391035000000 }));
  expect(result.discrepanciesFound).toBe(1);
  expect(result.companiesChecked).toBe(2);
});
