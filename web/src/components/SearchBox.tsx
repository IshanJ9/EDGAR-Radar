import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import type { Company } from '../lib/api';
import { searchCompanies } from '../lib/search';
import { companyPath } from '../lib/routes';
import { SearchIcon, ClearIcon, NoMatchIcon } from './icons';

/** Offered when a search matches nothing - well-known names a visitor can try. */
const SUGGESTED_TICKERS = ['AAPL', 'MSFT', 'TSLA'];

interface Props {
  /** The searchable universe; null while it is still loading. */
  companies: Company[] | null;
  /** True when the company list could not be loaded. */
  failed: boolean;
  /** 'hero' on the home page; 'compact' in the header of every other page. */
  variant?: 'hero' | 'compact';
}

/**
 * The home page's instant search, built as an ARIA combobox: results
 * update as you type; the arrow keys move through them and Enter opens one;
 * Escape clears; "/" anywhere on the page jumps here. Searching is entirely
 * in the browser, over the 196-company list loaded once.
 */
export function SearchBox({ companies, failed, variant = 'hero' }: Props) {
  const hero = variant === 'hero';
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const listId = useId();

  const results = useMemo(() => searchCompanies(companies ?? [], query), [companies, query]);
  const open = query.trim() !== '';
  const showResults = open && results.length > 0;

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.closest('input, textarea, select, [contenteditable="true"]');
      if (event.key === '/' && !typing && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const openCompany = (company: Company) => navigate(companyPath(company.ticker));

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' && showResults) {
      event.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (event.key === 'ArrowUp' && showResults) {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter' && showResults) {
      event.preventDefault();
      openCompany(results[Math.max(active, 0)]!);
    } else if (event.key === 'Escape') {
      setQuery('');
      setActive(-1);
    }
  }

  const optionId = (i: number) => `${listId}-option-${i}`;

  return (
    <div className="relative w-full max-w-[680px] text-left">
      <label htmlFor={`${listId}-input`} className="sr-only">
        Search for a company
      </label>
      <div
        className={
          hero
            ? 'flex h-[68px] items-center gap-3.5 rounded-input border-2 border-brand bg-surface px-[22px] shadow-[0_10px_30px_rgba(13,27,42,0.10)]'
            : 'flex h-11 items-center gap-2.5 rounded-[10px] border border-line bg-canvas px-3.5 focus-within:border-brand'
        }
      >
        <SearchIcon className={hero ? 'size-6 shrink-0 text-muted' : 'size-[18px] shrink-0 text-muted'} />
        <input
          ref={inputRef}
          id={`${listId}-input`}
          type="text"
          role="combobox"
          aria-expanded={showResults}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showResults && active >= 0 ? optionId(active) : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder={hero ? 'Search a company, e.g. Apple or TSLA' : 'Search another company'}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(-1);
          }}
          onKeyDown={onKeyDown}
          className={`min-w-0 grow bg-transparent text-ink outline-none placeholder:text-faint ${hero ? 'text-lg sm:text-xl' : 'text-[15px]'}`}
        />
        {query ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setQuery('');
              setActive(-1);
              inputRef.current?.focus();
            }}
            className={`flex shrink-0 items-center justify-center rounded-[10px] text-muted hover:bg-canvas ${hero ? 'size-11' : 'size-8'}`}
          >
            <ClearIcon className="size-5" />
          </button>
        ) : (
          hero && <kbd className="hidden rounded-md border border-line px-2 py-0.5 font-mono text-[13px] text-faint sm:block">/</kbd>
        )}
      </div>

      {/* Always rendered, so aria-controls always points at a real element. */}
      <ul
        id={listId}
        role="listbox"
        aria-label="Matching companies"
        hidden={!showResults}
        className="absolute inset-x-0 z-10 mt-2 flex flex-col rounded-[14px] border border-line bg-surface p-2 shadow-[0_16px_40px_rgba(13,27,42,0.12)]"
      >
        {results.map((company, i) => (
          <li
            key={company.cik}
            id={optionId(i)}
            role="option"
            aria-selected={i === active}
            onClick={() => openCompany(company)}
            onMouseEnter={() => setActive(i)}
            className={`flex cursor-pointer items-center gap-3.5 rounded-[10px] p-3.5 ${i === active ? 'bg-brand-tint' : ''}`}
          >
            <span
              aria-hidden="true"
              className={`flex size-10 shrink-0 items-center justify-center rounded-[10px] font-display text-[17px] font-bold ${i === active ? 'bg-brand text-white' : 'bg-line-soft text-body'}`}
            >
              {company.displayName.charAt(0)}
            </span>
            <span className="flex min-w-0 grow flex-col">
              <span className="truncate text-[17px] font-semibold">{company.displayName}</span>
              {company.industry && <span className="truncate text-sm text-muted">{company.industry}</span>}
            </span>
            <span className={`font-mono text-sm font-medium ${i === active ? 'text-link' : 'text-muted'}`}>{company.ticker}</span>
          </li>
        ))}
      </ul>

      {open && !showResults && (
        <div className="absolute inset-x-0 z-10 mt-2 rounded-[14px] border border-line bg-surface p-7 shadow-[0_16px_40px_rgba(13,27,42,0.12)]" role="status">
          {failed ? (
            <p className="text-base leading-relaxed text-muted">Search is unavailable right now - we couldn't load the company list. Please try again in a minute.</p>
          ) : companies === null ? (
            <p className="text-base text-muted">Loading companies…</p>
          ) : (
            <NoMatch query={query.trim()} companies={companies} />
          )}
        </div>
      )}
    </div>
  );
}

function NoMatch({ query, companies }: { query: string; companies: Company[] }) {
  const suggestions = SUGGESTED_TICKERS.map((t) => companies.find((c) => c.ticker === t)).filter((c): c is Company => c !== undefined);
  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex items-start gap-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-canvas text-muted" aria-hidden="true">
          <NoMatchIcon className="size-[22px]" />
        </span>
        <div className="flex flex-col gap-1.5">
          <p className="font-display text-[22px] font-semibold">No company matches “{query}”</p>
          <p className="text-base leading-relaxed text-muted">
            EDGAR Radar covers {companies.length} large US companies. Try a company name or its stock ticker - for example “Ford” or “F”.
          </p>
        </div>
      </div>
      {suggestions.length > 0 && (
        <div className="flex flex-col gap-3 border-t border-line-soft pt-[18px]">
          <span className="text-sm font-semibold text-body">Try one of these</span>
          <div className="flex flex-wrap gap-2.5">
            {suggestions.map((c) => (
              <Link
                key={c.ticker}
                to={companyPath(c.ticker)}
                className="inline-flex items-center gap-2.5 rounded-xl border border-line px-4 py-2.5 font-medium text-ink no-underline hover:border-brand hover:text-ink"
              >
                {c.displayName}
                <span className="font-mono text-[13px] text-muted">{c.ticker}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
