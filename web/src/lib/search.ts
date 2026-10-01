export interface Searchable {
  ticker: string;
  /** SEC's official name - still searched, since it is what some people know. */
  name: string;
  displayName: string;
}

/** Lower case, letters and digits only: "Coca-Cola Co" and "coca cola" both become "cocacolaco"/"cocacola". */
const compact = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');
const words = (text: string) => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/**
 * How well a company matches, lower is better; null for no match:
 * 0 exact ticker, 1 ticker prefix, 2 name starts with the query,
 * 3 a word in the name starts with it, 4 the name contains it.
 */
function rank(company: Searchable, query: string): number | null {
  const ticker = company.ticker.toLowerCase();
  if (ticker === query) return 0;
  if (ticker.startsWith(query)) return 1;
  let best: number | null = null;
  for (const name of [company.displayName, company.name]) {
    const whole = compact(name);
    const r = whole.startsWith(query) ? 2 : words(name).some((w) => w.startsWith(query)) ? 3 : whole.includes(query) ? 4 : null;
    if (r !== null && (best === null || r < best)) best = r;
  }
  return best;
}

/** Instant, client-side search over the 196 companies, best match first. */
export function searchCompanies<T extends Searchable>(companies: readonly T[], rawQuery: string, limit = 6): T[] {
  const query = compact(rawQuery);
  if (!query) return [];
  return companies
    .map((company) => ({ company, rank: rank(company, query) }))
    .filter((m): m is { company: T; rank: number } => m.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.company.displayName.length - b.company.displayName.length || a.company.displayName.localeCompare(b.company.displayName))
    .slice(0, limit)
    .map((m) => m.company);
}
