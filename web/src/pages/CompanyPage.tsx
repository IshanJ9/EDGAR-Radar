import { Link, useParams } from 'react-router';
import { useCompanies } from '../lib/useData';
import { NotFoundPage } from './NotFoundPage';

/**
 * A company's page. F2 ships only its address, so search results lead
 * somewhere real; F3 fills it in with the health scores, financial charts
 * and risk-factor changes.
 */
export function CompanyPage() {
  const { ticker = '' } = useParams();
  const companies = useCompanies();
  const company = companies.data?.find((c) => c.ticker.toLowerCase() === ticker.toLowerCase());

  if (companies.data && !company) return <NotFoundPage />;

  return (
    <section className="mx-auto flex max-w-[1200px] flex-col gap-4 px-4 py-16 sm:px-8">
      {company ? (
        <>
          <title>{`${company.displayName} - EDGAR Radar`}</title>
          <p className="m-0 font-mono text-sm font-medium text-link">{company.ticker}</p>
          <h1 className="m-0 font-display text-4xl font-bold tracking-[-0.02em]">{company.displayName}</h1>
          {company.industry && <p className="m-0 text-lg text-muted">{company.industry}</p>}
          <p className="m-0 max-w-[640px] text-base leading-relaxed text-muted">
            This company's full page - its health scores explained, its finances over the years and what changed in its list of risks - is being built.
          </p>
          <Link to="/" className="self-start">
            Search another company
          </Link>
        </>
      ) : companies.failed ? (
        <p className="m-0 text-base text-muted">We couldn't load this company right now. Please try again in a minute.</p>
      ) : (
        <p className="m-0 text-base text-muted">Loading…</p>
      )}
    </section>
  );
}
