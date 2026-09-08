import 'dotenv/config';

const CONTACT_EMAIL = process.env.EDGAR_CONTACT_EMAIL;
if (!CONTACT_EMAIL) {
  console.error('Missing EDGAR_CONTACT_EMAIL in .env (see .env.example).');
  process.exit(1);
}
const USER_AGENT = `EDGAR Radar (${CONTACT_EMAIL})`;

interface UsGaapFact {
  end: string;
  val: number;
  fy: number;
  fp: string;
  form: string;
  filed: string;
}

function mostRecentFact(
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

async function main() {
  const cik = process.argv[2];
  if (!cik) {
    console.error('Usage: npx ts-node index.ts <CIK>');
    process.exit(1);
  }

  const paddedCik = cik.padStart(10, '0');
  const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${paddedCik}.json`;

  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
  });

  console.log(`GET ${url} -> ${response.status}`);

  if (!response.ok) {
    if (response.status === 404) {
      console.error(
        `No XBRL company facts found for CIK ${paddedCik}. Either the CIK is invalid, or the company has never filed XBRL data.`,
      );
    } else {
      console.error(`Request failed with status ${response.status}.`);
    }
    process.exit(1);
  }

  const data = await response.json();
  console.log('entityName:', data.entityName);

  const revenue = mostRecentFact(data, ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax']);
  const netIncome = mostRecentFact(data, ['NetIncomeLoss', 'ProfitLoss']);

  if (revenue) {
    console.log(`Revenue [${revenue.tag}, period end ${revenue.fact.end}, ${revenue.fact.form}]: $${revenue.fact.val.toLocaleString('en-US')}`);
  } else {
    console.log('Revenue: no matching tag found');
  }

  if (netIncome) {
    console.log(`NetIncomeLoss [${netIncome.tag}, period end ${netIncome.fact.end}, ${netIncome.fact.form}]: $${netIncome.fact.val.toLocaleString('en-US')}`);
  } else {
    console.log('NetIncomeLoss: no matching tag found');
  }
}

main();
