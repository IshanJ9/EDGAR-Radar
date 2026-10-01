/**
 * Post-Phase 7 hardening, step 3 (F1a) - SEC form types in plain categories,
 * for the frontend's filings feed.
 */
import { carriesFinancialStatements, categorizeForm } from '../filingCategories';

test.each([
  ['10-K', 'annual-report'],
  ['10-K/A', 'annual-report'],
  ['20-F', 'annual-report'],
  ['10-Q', 'quarterly-report'],
  ['8-K', 'major-event'],
  ['8-K/A', 'major-event'],
  ['3', 'insider-trade'],
  ['4', 'insider-trade'],
  ['4/A', 'insider-trade'],
  ['144', 'insider-trade'],
  ['425', 'merger'],
  ['S-4', 'merger'],
  ['424B2', 'offering'],
  ['424B3', 'offering'],
  ['FWP', 'offering'],
  ['S-3ASR', 'offering'],
  ['25-NSE', 'exchange-notice'],
  ['DEF 14A', 'shareholder-vote'],
  ['SC 13G', 'major-holder'],
  ['SCHEDULE 13G/A', 'major-holder'],
  ['CORRESP', 'other'],
])('%s is %s', (form, category) => {
  expect(categorizeForm(form)).toBe(category);
});

// Post-Phase 7 hardening, step 4: only these filings change a company's
// XBRL financial statements, so only these are worth a companyfacts download.
describe('carriesFinancialStatements', () => {
  test('annual and quarterly reports, and their amendments, do', () => {
    for (const form of ['10-K', '10-Q', '10-K/A', '10-Q/A', '20-F', '40-F']) {
      expect(carriesFinancialStatements(form)).toBe(true);
    }
  });

  test("everything else does not - the week of 2026-09-25 to 10-02 in production had 2,028 filings and none of these", () => {
    for (const form of ['424B2', 'FWP', '4', '144', '8-K', '424B3', '425', 'SCHEDULE 13D/A', 'SD', '3', '3/A', '25-NSE', '6-K', 'DEF 14A']) {
      expect(carriesFinancialStatements(form)).toBe(false);
    }
  });
});
