import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Badge, LoadFailed, Loading } from '../components/company/ui';
import type { Company } from '../lib/api';
import { isFinancialCompany } from '../lib/explain';
import { coverage, hasConcern, ratingChip, SCORE_NAMES, scoredCount, type ScoreName } from '../lib/ratings';
import { companyPath } from '../lib/routes';
import { searchCompanies } from '../lib/search';
import { useCompanies } from '../lib/useData';

const PAGE_SIZE = 25;
type Show = 'all' | 'scored' | 'concerns';

const COLUMNS: { score: ScoreName; label: string }[] = [
  { score: 'altmanZ', label: 'Bankruptcy risk' },
  { score: 'piotroskiF', label: 'Financial strength' },
  { score: 'beneishM', label: 'Accounting red flags' },
];

/** Every company with its three ratings at a glance - filterable, 25 at a time. */
export function CompaniesPage() {
  const companies = useCompanies();
  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-6 px-4 pb-24 pt-10 sm:px-8">
      <title>All companies - EDGAR Radar</title>
      <meta name="description" content="Every company EDGAR Radar watches, with its bankruptcy-risk, financial-strength and accounting-red-flag ratings at a glance." />
      {companies.failed ? (
        <LoadFailed what="the company list" onRetry={companies.retry} />
      ) : !companies.data ? (
        <>
          <h1 className="m-0 font-display text-4xl font-bold tracking-[-0.02em]">All companies</h1>
          <Loading what="the company list" />
        </>
      ) : (
        <CompanyTable companies={companies.data} />
      )}
    </div>
  );
}

function CompanyTable({ companies }: { companies: Company[] }) {
  const [query, setQuery] = useState('');
  const [show, setShow] = useState<Show>('all');
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => [...companies].sort((a, b) => a.displayName.localeCompare(b.displayName)), [companies]);
  const { total, allThree, none } = coverage(companies);
  const shown = useMemo(() => {
    const byShow = sorted.filter((c) => (show === 'scored' ? scoredCount(c) === 3 : show === 'concerns' ? hasConcern(c) : true));
    if (!query.trim()) return byShow;
    const matches = new Set(searchCompanies(byShow, query, Infinity));
    return byShow.filter((c) => matches.has(c));
  }, [sorted, show, query]);

  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const rows = shown.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  const choose = (next: Show) => {
    setShow(next);
    setPage(0);
  };

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="m-0 font-display text-4xl font-bold tracking-[-0.02em]">All {total} companies</h1>
        <p className="m-0 max-w-[720px] text-lg text-muted">Every company we watch, with its three health ratings at a glance. Select one for the full picture.</p>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex h-11 w-full items-center rounded-[10px] border border-line bg-surface px-3.5 focus-within:border-brand lg:max-w-[360px]">
          <label htmlFor="company-filter" className="sr-only">
            Filter companies
          </label>
          <input
            id="company-filter"
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            placeholder="Filter by name or ticker"
            autoComplete="off"
            className="min-w-0 grow bg-transparent text-[15px] outline-none placeholder:text-faint"
          />
        </div>
        <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
          <ShowButton pressed={show === 'all'} onClick={() => choose('all')}>
            All {total}
          </ShowButton>
          <ShowButton pressed={show === 'scored'} onClick={() => choose('scored')}>
            All three scores ({allThree})
          </ShowButton>
          <ShowButton pressed={show === 'concerns'} onClick={() => choose('concerns')}>
            Any caution or flag
          </ShowButton>
        </div>
      </div>

      <p className="m-0 rounded-[12px] bg-brand-soft px-4 py-3 text-[15px] leading-relaxed text-body">
        Scores compare the same figures across years, so some companies can't be scored yet. Today <strong>{allThree} of {total}</strong> have all three
        scores and <strong>{none}</strong> have none - banks and insurers can't be scored by design.
      </p>

      <div className="overflow-x-auto rounded-card border border-line bg-surface">
        <table className="w-full min-w-[720px] border-collapse text-left">
          <caption className="sr-only">Companies and their health ratings</caption>
          <thead>
            <tr className="border-b border-line text-sm text-muted">
              <th scope="col" className="px-5 py-3 font-semibold">
                Company
              </th>
              {COLUMNS.map((c) => (
                <th key={c.score} scope="col" className="px-5 py-3 font-semibold">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((company) => (
              <Row key={company.cik} company={company} />
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="m-0 px-5 py-6 text-base text-muted">No company matches. Try a different name or ticker.</p>}
      </div>

      <div className="flex items-center justify-between gap-4 text-[15px] text-muted">
        <span aria-live="polite">
          {shown.length === 0 ? 'Showing 0 of 0' : `Showing ${current * PAGE_SIZE + 1}–${current * PAGE_SIZE + rows.length} of ${shown.length}`}
        </span>
        <div className="flex gap-2">
          <PageButton disabled={current === 0} onClick={() => setPage(current - 1)}>
            Previous page
          </PageButton>
          <PageButton disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
            Next page
          </PageButton>
        </div>
      </div>

      <p className="m-0 max-w-[820px] text-sm leading-relaxed text-muted">
        “Look closer” means the numbers move the way they did at some companies later found to have manipulated earnings. Fast-growing companies can
        trigger it too - it's a prompt to read further, not an accusation. Not investment advice.
      </p>
    </>
  );
}

function Row({ company }: { company: Company }) {
  const bank = scoredCount(company) === 0 && isFinancialCompany(company.industry);
  return (
    <tr className="border-b border-line-soft last:border-0">
      <th scope="row" className="px-5 py-3.5 text-left font-normal">
        <Link to={companyPath(company.ticker)} className="flex items-center gap-3 text-ink no-underline hover:text-link">
          <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-[9px] bg-line-soft font-display text-[15px] font-bold text-body">
            {company.displayName.charAt(0)}
          </span>
          <strong className="font-semibold">{company.displayName}</strong>
          <span className="font-mono text-[13px] text-muted">{company.ticker}</span>
        </Link>
      </th>
      {SCORE_NAMES.map((score) => {
        const chip = ratingChip(score, company.ratings[score]);
        return (
          <td key={score} className="px-5 py-3.5">
            {chip ? (
              <span className="flex items-center gap-2.5">
                <Badge tone={chip.tone}>{chip.label}</Badge>
                <span className="font-mono text-sm text-body">{chip.value}</span>
              </span>
            ) : (
              <span className="text-sm text-faint">{bank ? 'Not scored (bank)' : 'Not enough data'}</span>
            )}
          </td>
        );
      })}
    </tr>
  );
}

function ShowButton({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`min-h-11 rounded-full border px-4 text-[15px] font-medium ${pressed ? 'border-brand bg-brand text-white' : 'border-line bg-surface text-ink hover:border-brand'}`}
    >
      {children}
    </button>
  );
}

function PageButton({ disabled, onClick, children }: { disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="min-h-11 rounded-[10px] border border-line bg-surface px-4 font-medium text-ink enabled:hover:border-brand disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}
