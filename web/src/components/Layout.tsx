import { useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import { useCompanies } from '../lib/useData';
import { GitHubIcon, RadarLogo } from './icons';
import { SearchBox } from './SearchBox';

export const REPO_URL = 'https://github.com/IshanJ9/EDGAR-Radar';

const PAGES = [
  { to: '/companies', label: 'All companies' },
  { to: '/filings', label: 'Latest filings' },
  { to: '/how-it-works', label: 'How it works' },
];

const navLink = ({ isActive }: { isActive: boolean }) =>
  `flex min-h-11 items-center text-[15px] no-underline ${isActive ? 'font-semibold text-ink' : 'text-body hover:text-ink'}`;

/** The header and footer every page shares. */
export function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  // The page the phone menu was opened on: following a link closes it, with no effect needed.
  const [menuOpenOn, setMenuOpenOn] = useState<string | null>(null);
  const menuOpen = menuOpenOn === pathname;
  const onHome = pathname === '/';

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-30 focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2">
        Skip to content
      </a>
      <header className="relative z-20 border-b border-line bg-surface">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-4 gap-y-2.5 px-4 py-3.5 sm:px-8 md:h-[72px] md:flex-nowrap md:py-0 lg:gap-x-8">
          <Link to="/" className="flex shrink-0 items-center gap-2.5 text-ink no-underline hover:text-ink">
            <RadarLogo className="size-[30px] text-brand" />
            <span className="font-display text-[21px] font-bold tracking-[-0.01em]">EDGAR Radar</span>
          </Link>
          {/* The home page has its own large search; every other page gets a compact one here -
              one instance, which wraps onto its own row on a phone. */}
          {!onHome && (
            <div className="order-last min-w-0 basis-full md:order-none md:max-w-[420px] md:grow md:basis-auto">
              <HeaderSearch />
            </div>
          )}
          <span className={`grow ${onHome ? '' : 'md:hidden'}`} />
          <nav aria-label="Main" id="main-nav" className={`${menuOpen ? 'flex' : 'hidden'} md:flex`}>
            <ul
              className={`m-0 list-none p-0 ${menuOpen ? 'absolute inset-x-0 top-full flex flex-col border-b border-line bg-surface px-4 pb-3 shadow-[0_12px_24px_rgba(13,27,42,0.08)]' : ''} md:static md:flex md:flex-row md:gap-7 md:border-0 md:p-0 md:shadow-none`}
            >
              {PAGES.map((p) => (
                <li key={p.to}>
                  <NavLink to={p.to} className={navLink}>
                    {p.label}
                  </NavLink>
                </li>
              ))}
              <li className="md:hidden">
                <a href={REPO_URL} className="flex min-h-11 items-center gap-2 text-[15px] text-body no-underline">
                  <GitHubIcon className="size-[18px]" />
                  Source code
                </a>
              </li>
            </ul>
          </nav>
          <a href={REPO_URL} className="hidden min-h-11 shrink-0 items-center gap-2 text-[15px] text-body no-underline hover:text-ink md:flex">
            <GitHubIcon className="size-[18px]" />
            <span className="sr-only lg:not-sr-only">Source code</span>
          </a>
          <button
            type="button"
            aria-expanded={menuOpen}
            aria-controls="main-nav"
            onClick={() => setMenuOpenOn(menuOpen ? null : pathname)}
            className="flex min-h-11 items-center gap-2 rounded-[10px] border border-line px-3 text-[15px] font-medium text-ink md:hidden"
          >
            <MenuIcon open={menuOpen} />
            Menu
          </button>
        </div>
      </header>

      <main id="main" className="grow">
        {children}
      </main>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-[1200px] flex-col justify-between gap-3 px-4 py-7 text-sm text-muted sm:flex-row sm:px-8">
          <span>Data from SEC EDGAR, the US government's public filings archive. Not investment advice.</span>
          <Link to="/how-it-works">How EDGAR Radar works</Link>
        </div>
      </footer>
    </div>
  );
}

function HeaderSearch() {
  const companies = useCompanies();
  return <SearchBox companies={companies.data} failed={companies.failed} variant="compact" />;
}

function MenuIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
      {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
    </svg>
  );
}
