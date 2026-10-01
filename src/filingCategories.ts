/**
 * SEC form types grouped into plain categories for the frontend's filings
 * feed (post-Phase 7 hardening, step 3). A visitor sees "Insider trade", not
 * "Form 4".
 *
 * The poller enqueues every form a company files, and most are routine: on
 * 2026-09-30, 618 of the 662 filings discovered in 24 hours were banks' bond
 * prospectuses (424B2, FWP). Their own category, `offering`, lets the feed
 * fold them away.
 */
export type FilingCategory =
  | 'annual-report'
  | 'quarterly-report'
  | 'major-event'
  | 'insider-trade'
  | 'merger'
  | 'offering'
  | 'exchange-notice'
  | 'shareholder-vote'
  | 'major-holder'
  | 'other';

export const FILING_CATEGORIES: readonly FilingCategory[] = [
  'annual-report',
  'quarterly-report',
  'major-event',
  'insider-trade',
  'merger',
  'offering',
  'exchange-notice',
  'shareholder-vote',
  'major-holder',
  'other',
];

const EXACT: Record<string, FilingCategory> = {
  '10-K': 'annual-report',
  '20-F': 'annual-report',
  '40-F': 'annual-report',
  '10-Q': 'quarterly-report',
  '8-K': 'major-event',
  '6-K': 'major-event',
  '3': 'insider-trade',
  '4': 'insider-trade',
  '5': 'insider-trade',
  '144': 'insider-trade',
  '425': 'merger',
  'S-4': 'merger',
  DEFM14A: 'merger',
  FWP: 'offering',
  'S-3': 'offering',
  'S-3ASR': 'offering',
  '25-NSE': 'exchange-notice',
  '25': 'exchange-notice',
  'DEF 14A': 'shareholder-vote',
  DEFA14A: 'shareholder-vote',
  'SC 13D': 'major-holder',
  'SC 13G': 'major-holder',
  'SCHEDULE 13D': 'major-holder',
  'SCHEDULE 13G': 'major-holder',
};

export function categorizeForm(form: string): FilingCategory {
  // An amendment ("/A") belongs with the form it amends.
  const base = form.trim().toUpperCase().replace(/\/A$/, '');
  if (/^424B\d$/.test(base)) return 'offering';
  return EXACT[base] ?? 'other';
}

/**
 * Whether a filing can change a company's XBRL financial statements - the
 * facts behind the scores and the company page - and so is worth a fresh
 * companyfacts download (post-Phase 7 hardening, step 4). Annual and
 * quarterly reports and their amendments do; nothing else does. An 8-K's
 * structured data covers its cover page only, and prospectuses, insider
 * trades and the rest carry none. In production's week to 2026-10-02 the
 * poller found 2,028 filings, none of them annual or quarterly reports, and
 * every one used to trigger a companyfacts download.
 */
export function carriesFinancialStatements(form: string): boolean {
  const category = categorizeForm(form);
  return category === 'annual-report' || category === 'quarterly-report';
}
