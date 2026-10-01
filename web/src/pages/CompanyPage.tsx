import { Link, useParams } from 'react-router';
import { Financials } from '../components/company/Financials';
import { HealthCheck } from '../components/company/HealthCheck';
import { RiskChanges } from '../components/company/RiskChanges';
import type { Company, CompanyScores } from '../lib/api';
import { formatDate, summarize } from '../lib/explain';
import { useCompanies, useFinancials, useRiskFactorDiff, useScores } from '../lib/useData';
import { NotFoundPage } from './NotFoundPage';

/** A company's page, addressed by ticker: its health check, finances and risk-warning changes. */
export function CompanyPage() {
  const { ticker = '' } = useParams();
  const companies = useCompanies();
  const company = companies.data?.find((c) => c.ticker.toLowerCase() === ticker.toLowerCase());

  if (company) return <CompanyView company={company} />;
  if (companies.data) return <NotFoundPage />;
  return (
    <section className="mx-auto max-w-[1200px] px-4 py-16 sm:px-8">
      <p className="m-0 text-base text-muted">
        {companies.failed ? "We couldn't load this company right now. Please try again in a minute." : 'Loading…'}
      </p>
    </section>
  );
}

function CompanyView({ company }: { company: Company }) {
  // Each section loads on its own, so a slow or failed one never blocks the rest.
  const scores = useScores(company.cik);
  const financials = useFinancials(company.cik);
  const diff = useRiskFactorDiff(company.cik);
  const filed = financials.data?.latestAnnualReportFiled;
  const summary = scores.data ? summarize(company.displayName, verdicts(scores.data)) : null;

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-10 px-4 pb-24 pt-8 sm:px-8 sm:pt-10">
      <title>{`${company.displayName} (${company.ticker}) - EDGAR Radar`}</title>

      <section className="flex flex-col gap-5">
        <Link to="/" className="inline-flex min-h-11 items-center gap-1.5 self-start text-[15px] no-underline">
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Back to search
        </Link>
        <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div className="flex items-center gap-5">
            <span
              aria-hidden="true"
              className="hidden size-[72px] shrink-0 items-center justify-center rounded-[18px] bg-brand font-display text-[32px] font-bold text-white sm:flex"
            >
              {company.displayName.charAt(0)}
            </span>
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="m-0 font-display text-[34px] font-bold leading-tight tracking-[-0.02em] sm:text-[44px]">{company.displayName}</h1>
                <span className="rounded-lg bg-brand-soft px-2.5 py-1 font-mono text-[15px] font-medium text-link">{company.ticker}</span>
              </div>
              <span className="text-[15px] text-muted">
                {[company.industry, filed ? `latest annual report filed ${formatDate(filed)}` : null, `SEC company ID ${company.cik}`]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </div>
          </div>
          <a
            href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${company.cik}&type=10-K`}
            className="inline-flex min-h-11 items-center gap-2 self-start rounded-[10px] border border-line bg-surface px-4 text-[15px] font-medium text-ink no-underline hover:border-brand hover:text-ink md:self-auto"
          >
            Original filings on SEC.gov
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M7 17L17 7M9 7h8v8" />
            </svg>
          </a>
        </div>
        {summary && (
          <div className="flex items-start gap-4 rounded-card bg-ink px-6 py-5 text-white sm:px-8 sm:py-6">
            <svg viewBox="0 0 24 24" className="mt-1 size-6 shrink-0" fill="none" stroke="#9db7f5" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8h.01M11 12h1v4h1" />
            </svg>
            <p className="m-0 text-[17px] leading-relaxed sm:text-[19px]">
              <strong className="font-semibold">In short: </strong>
              <span>{summary}</span>
            </p>
          </div>
        )}
      </section>

      <HealthCheck scores={scores} industry={company.industry} />
      <Financials financials={financials} />
      <RiskChanges name={company.displayName} diff={diff} />
    </div>
  );
}

function verdicts({ scores }: CompanyScores) {
  return {
    altman: scores.altmanZ.status === 'ok' ? scores.altmanZ : undefined,
    piotroski: scores.piotroskiF.status === 'ok' ? scores.piotroskiF : undefined,
    beneish: scores.beneishM.status === 'ok' ? scores.beneishM : undefined,
  };
}
