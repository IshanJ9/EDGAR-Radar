import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { GitHubIcon, RadarLogo } from './icons';

export const REPO_URL = 'https://github.com/IshanJ9/EDGAR-Radar';

/**
 * The header and footer every page shares. Navigation links to the other
 * pages (all companies, latest filings, how it works) are added as those
 * pages are built, so the site never links to a page that does not exist.
 */
export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-20 focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2">
        Skip to content
      </a>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-[72px] max-w-[1200px] items-center gap-8 px-4 sm:px-8">
          <Link to="/" className="flex items-center gap-2.5 text-ink no-underline hover:text-ink">
            <RadarLogo className="size-[30px] text-brand" />
            <span className="font-display text-[21px] font-bold tracking-[-0.01em]">EDGAR Radar</span>
          </Link>
          <span className="grow" />
          <a href={REPO_URL} className="flex min-h-11 items-center gap-2 text-[15px] text-body no-underline hover:text-ink">
            <GitHubIcon className="size-[18px]" />
            <span className="hidden sm:inline">Source code</span>
            <span className="sr-only sm:hidden">Source code on GitHub</span>
          </a>
        </div>
      </header>

      <main id="main" className="grow">
        {children}
      </main>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto max-w-[1200px] px-4 py-7 text-sm text-muted sm:px-8">
          Data from SEC EDGAR, the US government's public filings archive. Not investment advice.
        </div>
      </footer>
    </div>
  );
}
