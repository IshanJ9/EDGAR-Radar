/**
 * Post-Phase 7 hardening, step 3 (F1a) - SEC form types in plain categories,
 * for the frontend's filings feed.
 */
import { categorizeForm } from '../filingCategories';

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
