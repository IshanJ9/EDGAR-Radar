import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { LoadFailed, Loading } from '../components/company/ui';
import { CATEGORY_LABEL, describeGroup, FEED_FILTERS, groupFilings, matchesFilter, relativeTime, type FeedFilter, type FilingGroup } from '../lib/feed';
import { companyPath } from '../lib/routes';
import { useRecentFilings, useStats } from '../lib/useData';

const number = new Intl.NumberFormat('en-US');

/** Everything the 196 companies filed with the SEC recently, newest first, one line per company and kind of filing. */
export function FilingsPage() {
  const [hours, setHours] = useState<24 | 168>(24);
  const [filter, setFilter] = useState<FeedFilter>('everything');
  const feed = useRecentFilings(hours);
  const stats = useStats();
  const span = hours === 24 ? 'the last 24 hours' : 'the last 7 days';

  const groups = useMemo(() => (feed.data ? groupFilings(feed.data.filings) : []), [feed.data]);
  const visible = groups.filter((g) => matchesFilter(filter, g.category));
  const offerings = feed.data?.countsByCategory.offering ?? 0;

  return (
    <div className="mx-auto grid max-w-[1200px] gap-8 px-4 pb-24 pt-10 sm:px-8 lg:grid-cols-[1fr_320px]">
      <title>Latest filings - EDGAR Radar</title>
      <meta name="description" content="Everything 196 large US companies filed with the SEC recently, in plain English, checked every 30 minutes." />
      <section className="flex min-w-0 flex-col gap-6">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="m-0 font-display text-4xl font-bold tracking-[-0.02em]">Latest filings</h1>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-good-soft px-3 py-1 text-sm font-medium text-good-ink">
              <span className="size-2 rounded-full bg-good" aria-hidden="true" />
              Live
            </span>
          </div>
          <p className="m-0 text-lg text-muted">Everything our companies filed with the SEC in {span}, newest first. Checked every 30 minutes.</p>
        </div>

        <div role="group" aria-label="Filter by kind of filing" className="flex flex-wrap gap-2">
          {FEED_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={`min-h-11 rounded-full border px-4 text-[15px] font-medium ${filter === f.id ? 'border-brand bg-brand text-white' : 'border-line bg-surface text-ink hover:border-brand'}`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {feed.failed ? (
          <LoadFailed what="the latest filings" onRetry={feed.retry} />
        ) : !feed.data ? (
          <Loading what="the latest filings" />
        ) : (
          <div className="flex flex-col overflow-hidden rounded-card border border-line bg-surface">
            {filter === 'everything' && offerings > 0 && (
              <div className="flex items-start gap-4 border-b border-line-soft bg-canvas px-5 py-4">
                <span className="w-[72px] shrink-0 text-sm text-muted">Folded</span>
                <span className="flex flex-col gap-0.5">
                  <span className="font-semibold">{number.format(offerings)} routine offers of notes and bonds</span>
                  <span className="text-sm text-muted">Big banks file these every day for the notes and bonds they issue, so they're counted here rather than listed.</span>
                </span>
              </div>
            )}
            {visible.length === 0 ? (
              <p className="m-0 px-5 py-6 text-base text-muted">Nothing of this kind was filed in {span}.</p>
            ) : (
              <ul className="m-0 list-none p-0">
                {visible.map((g) => (
                  <li key={`${g.cik}|${g.category}`} className="border-b border-line-soft last:border-0">
                    <FeedLine group={g} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {hours === 24 && feed.data && (
          <button
            type="button"
            onClick={() => setHours(168)}
            className="min-h-11 self-start rounded-[10px] border border-line bg-surface px-4 text-[15px] font-medium text-ink hover:border-brand"
          >
            Show the last 7 days
          </button>
        )}
      </section>

      <aside className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-4 rounded-card bg-ink p-6 text-white">
          <span className="col-span-2 text-sm text-on-dark-muted">{hours === 24 ? 'Last 24 hours' : 'Last 7 days'}</span>
          <Figure value={feed.data ? number.format(feed.data.total) : '—'} label="filings found" />
          <Figure value={stats.data?.lastPoll ? relativeTime(stats.data.lastPoll.finishedAt) : '—'} label="last check" />
        </div>
        <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-6">
          <h2 className="m-0 font-display text-xl font-semibold">What the labels mean</h2>
          <Legend term="Major event">news a company must report within days: a deal, a leadership change, results.</Legend>
          <Legend term="Insider trade">an executive or director bought, sold, or plans to sell shares.</Legend>
          <Legend term="Merger">a message about a proposed merger or acquisition.</Legend>
          <Legend term="Annual / quarterly report">the full financial reports behind our scores.</Legend>
        </div>
      </aside>
    </div>
  );
}

function FeedLine({ group }: { group: FilingGroup }) {
  const body = (
    <>
      <span className="w-[72px] shrink-0 pt-0.5 text-sm text-muted">{relativeTime(group.latestAt)}</span>
      <span className="flex min-w-0 grow flex-col gap-0.5">
        <span className="font-semibold">
          {group.displayName} {group.ticker && <span className="font-mono text-[13px] font-medium text-muted">{group.ticker}</span>}
        </span>
        <span className="text-[15px] text-body">{describeGroup(group)}</span>
      </span>
      <span className="hidden shrink-0 rounded-full bg-canvas px-3 py-1 text-sm font-medium text-body sm:block">{CATEGORY_LABEL[group.category]}</span>
    </>
  );
  const row = 'flex items-start gap-4 px-5 py-4';
  return group.ticker ? (
    <Link to={companyPath(group.ticker)} className={`${row} text-ink no-underline hover:bg-canvas hover:text-ink`}>
      {body}
    </Link>
  ) : (
    <div className={row}>{body}</div>
  );
}

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-display text-[28px] font-bold leading-none">{value}</span>
      <span className="text-sm text-on-dark-muted">{label}</span>
    </div>
  );
}

function Legend({ term, children }: { term: string; children: ReactNode }) {
  return (
    <p className="m-0 text-[15px] leading-relaxed text-body">
      <strong className="font-semibold text-ink">{term}</strong> - {children}
    </p>
  );
}
