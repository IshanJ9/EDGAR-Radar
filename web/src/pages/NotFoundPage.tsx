import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <section className="mx-auto flex max-w-[1200px] flex-col items-start gap-4 px-4 py-24 sm:px-8">
      <title>Page not found - EDGAR Radar</title>
      <h1 className="m-0 font-display text-4xl font-bold">Page not found</h1>
      <p className="m-0 max-w-[560px] text-lg leading-relaxed text-muted">
        There's nothing at this address. If you were looking for a company, search for it by name or stock ticker.
      </p>
      <Link to="/" className="flex min-h-11 items-center text-base font-medium">
        Back to the home page
      </Link>
    </section>
  );
}
