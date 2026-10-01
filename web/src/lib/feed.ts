import { displayName } from './names';

/** One filing, as `GET /filings/recent` returns it. */
export interface Filing {
  accessionNumber: string;
  cik: string;
  form: string;
  filingDate: string;
  discoveredAt: string;
  ticker: string | null;
  name: string | null;
  category: FilingCategory;
}

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

/** A company's filings of one kind in the window, shown as one line. */
export interface FilingGroup {
  cik: string;
  ticker: string | null;
  displayName: string;
  category: FilingCategory;
  count: number;
  forms: string[];
  /** When the newest of them was found. */
  latestAt: string;
}

/** Folds the feed into one line per company and kind of filing, newest first. */
export function groupFilings(filings: Filing[]): FilingGroup[] {
  const groups = new Map<string, FilingGroup>();
  for (const f of filings) {
    const key = `${f.cik}|${f.category}`;
    const group = groups.get(key);
    if (group) {
      group.count += 1;
      if (!group.forms.includes(f.form)) group.forms.push(f.form);
      if (f.discoveredAt > group.latestAt) group.latestAt = f.discoveredAt;
    } else {
      groups.set(key, {
        cik: f.cik,
        ticker: f.ticker,
        displayName: f.ticker && f.name ? displayName(f.ticker, f.name) : (f.name ?? f.cik),
        category: f.category,
        count: 1,
        forms: [f.form],
        latestAt: f.discoveredAt,
      });
    }
  }
  return [...groups.values()].sort((a, b) => b.latestAt.localeCompare(a.latestAt));
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`);

/** What a group of filings means, in a short plain-English sentence. */
export function describeGroup({ category, count, forms }: Pick<FilingGroup, 'category' | 'count' | 'forms'>): string {
  switch (category) {
    case 'annual-report':
      return count === 1 ? 'Filed its annual report' : `Filed ${count} annual-report documents`;
    case 'quarterly-report':
      return count === 1 ? 'Filed its quarterly report' : `Filed ${count} quarterly-report documents`;
    case 'major-event':
      return count === 1 ? 'Reported a major event' : `Reported ${count} major events`;
    case 'insider-trade':
      if (count === 1 && forms[0] === '144') return 'An insider gave notice of a planned share sale';
      return count === 1 ? 'An insider trade reported' : `${count} insider trades reported`;
    case 'merger':
      return `Published ${plural(count, 'a communication', 'communications')} about a merger`;
    case 'offering':
      return `Filed ${plural(count, 'an offer', 'offers')} of notes or shares`;
    case 'exchange-notice':
      return 'A stock exchange gave notice about one of its securities';
    case 'shareholder-vote':
      return 'Published material for a shareholder vote';
    case 'major-holder':
      return 'A large shareholder reported its stake';
    default:
      // Form SD is the yearly conflict-minerals report - the only "other" form in a week of the live feed.
      if (forms.length === 1 && forms[0] === 'SD') return 'Filed its conflict-minerals report';
      return count === 1 ? `Filed a form ${forms[0]}` : `Filed ${count} other documents`;
  }
}

/** The short label shown on each line. */
export const CATEGORY_LABEL: Record<FilingCategory, string> = {
  'annual-report': 'Annual report',
  'quarterly-report': 'Quarterly report',
  'major-event': 'Major event',
  'insider-trade': 'Insider trade',
  merger: 'Merger',
  offering: 'Offering',
  'exchange-notice': 'Exchange notice',
  'shareholder-vote': 'Shareholder vote',
  'major-holder': 'Major shareholder',
  other: 'Other',
};

export type FeedFilter = 'everything' | 'events' | 'insider' | 'reports' | 'mergers';

export const FEED_FILTERS: { id: FeedFilter; label: string; categories: FilingCategory[] | null }[] = [
  { id: 'everything', label: 'Everything', categories: null },
  { id: 'events', label: 'Major events', categories: ['major-event'] },
  { id: 'insider', label: 'Insider trades', categories: ['insider-trade'] },
  { id: 'reports', label: 'Annual and quarterly reports', categories: ['annual-report', 'quarterly-report'] },
  { id: 'mergers', label: 'Mergers', categories: ['merger'] },
];

export function matchesFilter(filter: FeedFilter, category: FilingCategory): boolean {
  const categories = FEED_FILTERS.find((f) => f.id === filter)?.categories ?? null;
  return categories === null || categories.includes(category);
}

/** "just now", "25 min ago", "2 hr ago", "3 days ago". */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const seconds = Math.max(0, (now.getTime() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}
