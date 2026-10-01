import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ClockIcon, DocumentIcon, PulseIcon } from '../components/icons';
import { SearchBox } from '../components/SearchBox';
import type { Company } from '../lib/api';
import { companyPath } from '../lib/routes';
import { useCompanies, useStats } from '../lib/useData';

/** Well-known names offered under the search box, in this order. */
const TRY_TICKERS = ['MSFT', 'TSLA', 'NVDA', 'JPM', 'KO'];

const number = new Intl.NumberFormat('en-US');

export function HomePage() {
  const companies = useCompanies();
  const stats = useStats();
  const watched = stats.data?.companiesMonitored ?? companies.data?.length ?? null;

  return (
    <>
      <title>EDGAR Radar - plain-English health checks for big US companies</title>
      <section className="mx-auto flex max-w-[1200px] flex-col items-center gap-6 px-4 pb-16 pt-14 text-center sm:px-8 sm:pb-[72px] sm:pt-24">
        <div className="inline-flex items-center gap-2 rounded-full bg-good-soft px-3.5 py-1.5 text-sm font-medium text-good-ink">
          <span className="size-2 rounded-full bg-good" aria-hidden="true" />
          Watching {watched === null ? 'large US' : number.format(watched)} companies · checked every 30 minutes
        </div>
        <h1 className="m-0 max-w-[900px] font-display text-[40px] font-bold leading-[1.05] tracking-[-0.025em] sm:text-6xl">
          Spot the warning signs in America's biggest companies.
        </h1>
        <p className="m-0 max-w-[680px] text-lg leading-relaxed text-muted sm:text-xl">
          EDGAR Radar reads the official reports companies file with the SEC, checks the numbers, and explains what they mean - and what changed - in
          plain English.
        </p>

        <div className="mt-4 flex w-full justify-center">
          <SearchBox companies={companies.data} failed={companies.failed} />
        </div>

        <TryLinks companies={companies.data} />
      </section>

      <section className="mx-auto max-w-[1200px] px-4 pb-24 pt-6 sm:px-8">
        <div className="grid gap-6 md:grid-cols-3">
          <Feature icon={<PulseIcon className="size-[26px] text-brand" />} tint="bg-brand-soft" title="A health check, explained">
            Three scores analysts have trusted for decades - bankruptcy risk, financial strength, accounting red flags - each with the reasons behind it.
          </Feature>
          <Feature icon={<DocumentIcon className="size-[26px] text-warn" />} tint="bg-warn-soft" title="What they started worrying about">
            We compare each annual report's list of risks with the year before and show you what's new and what quietly disappeared.
          </Feature>
          <Feature icon={<ClockIcon className="size-[26px] text-good" />} tint="bg-good-soft" title="Always up to date">
            New filings are picked up within 30 minutes, and every number is double-checked against the SEC's full records each night.
          </Feature>
        </div>
      </section>

      <section aria-label="EDGAR Radar by the numbers" className="bg-ink text-white">
        <dl className="mx-auto grid max-w-[1200px] grid-cols-2 gap-6 px-4 py-14 sm:px-8 md:grid-cols-4">
          <Stat value={watched === null ? '—' : number.format(watched)} label="large US companies watched" />
          <Stat value="30 min" label="between checks for new filings" />
          <Stat value={stats.data ? number.format(stats.data.factsStored) : '—'} label="financial figures on record" />
          <Stat value={stats.data ? number.format(stats.data.filingsDiscoveredLast24h) : '—'} label="new filings picked up in the last 24 hours" />
        </dl>
      </section>
    </>
  );
}

function TryLinks({ companies }: { companies: Company[] | null }) {
  const picks = TRY_TICKERS.map((t) => companies?.find((c) => c.ticker === t)).filter((c): c is Company => c !== undefined);
  if (picks.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center justify-center gap-2.5 text-[15px] text-muted">
      <span>Try:</span>
      {picks.map((c) => (
        <Link
          key={c.ticker}
          to={companyPath(c.ticker)}
          className="flex min-h-11 items-center rounded-full border border-line bg-surface px-4 font-medium text-ink no-underline hover:border-brand hover:text-ink"
        >
          {c.displayName}
        </Link>
      ))}
    </div>
  );
}

function Feature({ icon, tint, title, children }: { icon: ReactNode; tint: string; title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3.5 rounded-card border border-line bg-surface p-8">
      <span className={`flex size-12 items-center justify-center rounded-xl ${tint}`}>{icon}</span>
      <h2 className="m-0 font-display text-[23px] font-semibold">{title}</h2>
      <p className="m-0 text-base leading-relaxed text-muted">{children}</p>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col-reverse gap-1.5">
      <dt className="text-[15px] text-on-dark-muted">{label}</dt>
      <dd className="m-0 font-display text-[32px] font-bold sm:text-[40px]">{value}</dd>
    </div>
  );
}
