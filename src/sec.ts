const CONTACT_EMAIL = process.env.EDGAR_CONTACT_EMAIL;
if (!CONTACT_EMAIL) {
  throw new Error('Missing EDGAR_CONTACT_EMAIL in .env (see .env.example).');
}
const USER_AGENT = `EDGAR Radar (${CONTACT_EMAIL})`;

export interface UsGaapFact {
  end: string;
  val: number;
  fy: number;
  fp: string;
  form: string;
  filed: string;
}

export class CompanyFactsNotFoundError extends Error {}

export function padCik(cik: string): string {
  return cik.padStart(10, '0');
}

export async function fetchCompanyFacts(cik: string): Promise<any> {
  const paddedCik = padCik(cik);
  const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${paddedCik}.json`;

  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new CompanyFactsNotFoundError(
        `No XBRL company facts found for CIK ${paddedCik}. Either the CIK is invalid, or the company has never filed XBRL data.`,
      );
    }
    throw new Error(`Request to ${url} failed with status ${response.status}.`);
  }

  return response.json();
}

export function mostRecentFact(
  companyFacts: any,
  tags: string[],
): { tag: string; fact: UsGaapFact } | null {
  let best: { tag: string; fact: UsGaapFact } | null = null;
  for (const tag of tags) {
    const values: UsGaapFact[] | undefined = companyFacts?.facts?.['us-gaap']?.[tag]?.units?.USD;
    if (!Array.isArray(values) || values.length === 0) continue;
    const latest = [...values].sort((a, b) => a.end.localeCompare(b.end)).at(-1)!;
    if (!best || latest.end > best.fact.end) {
      best = { tag, fact: latest };
    }
  }
  return best;
}

export const REVENUE_TAGS = ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax'];
export const NET_INCOME_TAGS = ['NetIncomeLoss', 'ProfitLoss'];
