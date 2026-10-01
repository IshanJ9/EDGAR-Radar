import { useId, type ReactNode } from 'react';
import { REPO_URL } from '../components/Layout';
import { relativeTime } from '../lib/feed';
import { useStats } from '../lib/useData';

const number = new Intl.NumberFormat('en-US');

const STEPS: [title: string, text: string][] = [
  ['Watch', 'Every 30 minutes, checks all 196 companies for anything new they have filed.'],
  ['Read', 'Pulls the key figures - revenue, profit, debt, cash - out of each report.'],
  ['Check', "Sets aside numbers that can't be right, and re-checks every figure against the SEC's full records each night."],
  ['Score', 'Works out three health scores, keeping the reasons behind each.'],
  ['Compare', "Lines up this year's risk warnings with last year's, by meaning, not just wording."],
  ['Guard', 'A watchdog raises one alert if anything stops, and the data is backed up off the server every night.'],
];

/** The pipeline in plain English, the live numbers, the scores and where the data comes from. */
export function HowItWorksPage() {
  const stats = useStats();
  const s = stats.data;
  const nowId = useId();
  const scoresId = useId();

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-14 px-4 pb-24 pt-10 sm:px-8">
      <title>How it works - EDGAR Radar</title>
      <meta name="description" content="How EDGAR Radar reads SEC filings, checks the numbers, scores companies and compares their risk warnings - all automatically." />
      <section className="flex max-w-[820px] flex-col gap-4">
        <h1 className="m-0 font-display text-[40px] font-bold leading-tight tracking-[-0.02em] sm:text-5xl">How EDGAR Radar works</h1>
        <p className="m-0 text-xl leading-relaxed text-muted">
          A handful of automated workers run around the clock, each with one job. Together they read what companies file, check it, and turn it into
          something anyone can understand.
        </p>
      </section>

      <section aria-label="The six steps">
        <h2 className="sr-only">The six steps</h2>
        <ol className="m-0 grid list-none gap-5 p-0 sm:grid-cols-2 lg:grid-cols-3">
          {STEPS.map(([title, text], i) => (
            <li key={title} className="flex flex-col gap-2.5 rounded-card border border-line bg-surface p-7">
              <span className="font-mono text-sm font-medium text-link" aria-hidden="true">
                {String(i + 1).padStart(2, '0')}
              </span>
              <h3 className="m-0 font-display text-2xl font-semibold">{title}</h3>
              <p className="m-0 text-base leading-relaxed text-muted">{text}</p>
            </li>
          ))}
        </ol>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section aria-labelledby={nowId} className="flex flex-col gap-5 rounded-card bg-ink p-8 text-white">
          <div className="flex items-center gap-3">
            <h2 id={nowId} className="m-0 font-display text-2xl font-semibold">
              Right now
            </h2>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-sm">
              <span className="size-2 rounded-full bg-[#4ade80]" aria-hidden="true" />
              Live
            </span>
          </div>
          <dl className="m-0 grid grid-cols-2 gap-6">
            <Stat value={s?.lastPoll ? relativeTime(s.lastPoll.finishedAt) : '—'} label="last check for new filings" />
            <Stat value={s ? number.format(s.filingsDiscoveredLast24h) : '—'} label="filings found in the last 24 hours" />
            <Stat value={s ? number.format(s.factsStored) : '—'} label="financial figures on record" />
            <Stat
              value={s?.lastReconciliation ? number.format(s.lastReconciliation.discrepanciesFound) : '—'}
              label={`figures corrected in last night's cross-check of ${s?.lastReconciliation?.companiesChecked ?? 196} companies`}
            />
          </dl>
        </section>
        <section aria-label="Where the data comes from" className="flex flex-col gap-3 rounded-card border border-line bg-surface p-8">
          <h2 className="m-0 font-display text-2xl font-semibold">Where the data comes from</h2>
          <p className="m-0 text-base leading-relaxed text-body">
            Everything comes from <strong>SEC EDGAR</strong>, the US government's free archive of company filings. Companies are required by law to file
            there, so the numbers are the companies' own official figures.
          </p>
          <p className="m-0 text-base leading-relaxed text-body">
            EDGAR Radar covers <strong>196 large, well-known US companies</strong> - from Apple and Microsoft to JPMorgan Chase and Coca-Cola.
          </p>
          <p className="m-0 text-base leading-relaxed text-body">
            It is a tool for looking closer, <strong>not investment advice</strong>.
          </p>
        </section>
      </div>

      <section id="scores" aria-labelledby={scoresId} className="flex scroll-mt-6 flex-col gap-5">
        <h2 id={scoresId} className="m-0 font-display text-[28px] font-semibold">
          The three health scores, in plain English
        </h2>
        <div className="grid gap-5 lg:grid-cols-3">
          <Score title="Bankruptcy risk" source="Altman Z″ score · 1968, adapted 1995">
            Does the balance sheet look like those of companies that later went bankrupt? Above 2.6 is safe; below 1.1 is high risk. It doesn't fit banks
            and insurers, which aren't scored.
          </Score>
          <Score title="Financial strength" source="Piotroski F-Score · 2000">
            Nine simple yes/no checks - is it profitable, is debt falling, are margins improving? More yeses means a stronger business. It compares two
            years.
          </Score>
          <Score title="Accounting red flags" source="Beneish M-Score · 1999">
            Do the numbers move the way they did at companies later caught inflating their earnings? Above −2.22 is worth a closer look - a prompt, not
            an accusation. It compares two years.
          </Score>
        </div>
        <p className="m-0 max-w-[820px] text-[15px] leading-relaxed text-muted">
          A score appears only when every figure it needs is filed for the same year (or two consecutive years). Where a company doesn't report a figure
          directly, it is calculated from its parts - gross profit from revenue minus cost of revenue, for example - and the company page says so.
        </p>
      </section>

      <section aria-label="For the technically curious" className="grid gap-6 rounded-card border border-line bg-surface p-8 lg:grid-cols-[1fr_1.2fr]">
        <div className="flex flex-col gap-3">
          <h2 className="m-0 font-display text-2xl font-semibold">For the technically curious</h2>
          <p className="m-0 text-base leading-relaxed text-body">
            TypeScript and Node.js services with PostgreSQL, Redis queues and a read replica, running on a free Oracle Cloud server - $0 a month. Every
            change passes automated tests before it goes live.
          </p>
          <a href={REPO_URL} className="flex min-h-11 items-center self-start font-medium">
            Read the code on GitHub
          </a>
        </div>
        <dl className="m-0 grid grid-cols-2 gap-6">
          <Tech value="≤ 10/s" label="requests to the SEC, guaranteed by a test" />
          <Tech value="4,165/s" label="requests served from cache in a load test" />
          <Tech value="1 alert" label="per outage, proven by stopping it on purpose" />
          <Tech value="400+" label="automated tests on every change" />
        </dl>
      </section>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col-reverse gap-1">
      <dt className="text-sm text-on-dark-muted">{label}</dt>
      <dd className="m-0 font-display text-[32px] font-bold leading-none">{value}</dd>
    </div>
  );
}

function Tech({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col-reverse gap-1">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="m-0 font-display text-[28px] font-bold leading-none text-ink">{value}</dd>
    </div>
  );
}

function Score({ title, source, children }: { title: string; source: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-card border border-line bg-surface p-7">
      <h3 className="m-0 font-display text-xl font-semibold">{title}</h3>
      <span className="text-sm text-muted">{source}</span>
      <p className="m-0 text-base leading-relaxed text-body">{children}</p>
    </div>
  );
}
