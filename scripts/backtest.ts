import 'dotenv/config';
import {
  fetchCompanyFacts,
  annualFacts,
  padCik,
  REVENUE_TAGS,
  NET_INCOME_TAGS,
  ASSETS_TAGS,
  LIABILITIES_TAGS,
  CURRENT_ASSETS_TAGS,
  CURRENT_LIABILITIES_TAGS,
  RETAINED_EARNINGS_TAGS,
  OPERATING_INCOME_TAGS,
  STOCKHOLDERS_EQUITY_TAGS,
  OPERATING_CASH_FLOW_TAGS,
  LONG_TERM_DEBT_TAGS,
  SHARES_OUTSTANDING_TAGS,
  GROSS_PROFIT_TAGS,
  RECEIVABLES_TAGS,
  PPE_TAGS,
  DEPRECIATION_TAGS,
  SGA_TAGS,
} from '../src/sec';
import { upsertFact, upsertCompanyFacts } from '../src/repositories/companyRepository';
import { computeAltmanZDoublePrime, computePiotroskiFScore, computeBeneishMScore } from '../src/scoring';
import { pool } from '../src/db';

// Same 17 concepts src/repositories/companyRepository.ts extracts for
// ongoing ingestion, reused here to pull *historical* years instead of
// just the current-most-recent 2.
const CONCEPTS: { tags: string[]; unit: 'USD' | 'shares' }[] = [
  { tags: REVENUE_TAGS, unit: 'USD' },
  { tags: NET_INCOME_TAGS, unit: 'USD' },
  { tags: ASSETS_TAGS, unit: 'USD' },
  { tags: LIABILITIES_TAGS, unit: 'USD' },
  { tags: CURRENT_ASSETS_TAGS, unit: 'USD' },
  { tags: CURRENT_LIABILITIES_TAGS, unit: 'USD' },
  { tags: RETAINED_EARNINGS_TAGS, unit: 'USD' },
  { tags: OPERATING_INCOME_TAGS, unit: 'USD' },
  { tags: STOCKHOLDERS_EQUITY_TAGS, unit: 'USD' },
  { tags: OPERATING_CASH_FLOW_TAGS, unit: 'USD' },
  { tags: LONG_TERM_DEBT_TAGS, unit: 'USD' },
  { tags: SHARES_OUTSTANDING_TAGS, unit: 'shares' },
  { tags: GROSS_PROFIT_TAGS, unit: 'USD' },
  { tags: RECEIVABLES_TAGS, unit: 'USD' },
  { tags: PPE_TAGS, unit: 'USD' },
  { tags: DEPRECIATION_TAGS, unit: 'USD' },
  { tags: SGA_TAGS, unit: 'USD' },
];

interface BacktestCase {
  cik: string;
  ticker: string;
  name: string;
  years: number[]; // fiscal years to score "as of" - each compared to its own prior year
  context: string;
}

const CASES: BacktestCase[] = [
  {
    cik: '0001336917',
    ticker: 'UAA',
    name: 'Under Armour, Inc.',
    years: [2015, 2016],
    context:
      'SEC order (Dec 2021, $9M penalty): Under Armour pulled forward sales from future quarters into the current quarter ("channel stuffing") from Q3 2015 through Q4 2016 to appear to meet analyst revenue growth estimates.',
  },
  {
    cik: '0001637459',
    ticker: 'KHC',
    name: 'Kraft Heinz Co',
    years: [2017, 2018],
    context:
      'SEC investigation (disclosed Feb 2019) into Kraft Heinz\'s procurement/vendor-rebate accounting practices; a $15.4B goodwill/intangible impairment and a "material weakness" in internal controls were disclosed alongside FY2018 results.',
  },
  {
    cik: '0000040545',
    ticker: 'GE',
    name: 'GENERAL ELECTRIC CO',
    years: [2017, 2018],
    context:
      'Harry Markopolos report (Aug 2019) alleged GE accounting fraud "bigger than Enron and WorldCom combined," centered on GE Capital long-term-care insurance reserves and GE Power services accounting, covering years through 2018. GE disputed the allegations; no fraud was ever formally established - included here as a "aggressive accounting under public dispute" case, not a settled one like UAA/KHC.',
  },
];

async function ingestHistoricalYears(cik: string, maxFiscalYear: number, historyDepth: number): Promise<void> {
  const data = await fetchCompanyFacts(cik);
  const paddedCik = padCik(cik);
  for (const concept of CONCEPTS) {
    const result = annualFacts(data, concept.tags, concept.unit, historyDepth, maxFiscalYear);
    if (!result) continue;
    for (const fact of result.facts) {
      await upsertFact(paddedCik, result.tag, fact, result.unit);
    }
  }
}

function formatOutcome(outcome: { status: string; value?: number; classification?: string; reason?: string }): string {
  if (outcome.status === 'ok') return `${outcome.value} (${outcome.classification})`;
  return `insufficient-history: ${outcome.reason}`;
}

async function main() {
  for (const testCase of CASES) {
    console.log(`\n${'='.repeat(78)}\n${testCase.ticker} - ${testCase.name}`);
    console.log(`Context: ${testCase.context}`);
    console.log('='.repeat(78));

    await upsertCompanyFacts(testCase.cik); // ensures the companies row exists (FK requirement) + current data

    const maxYear = Math.max(...testCase.years);
    const minYear = Math.min(...testCase.years);
    const depth = maxYear - minYear + 2; // +1 for each tested year's own prior-year comparison
    await ingestHistoricalYears(testCase.cik, maxYear, depth);

    for (const year of testCase.years) {
      console.log(`\n--- FY${year} (vs FY${year - 1}) ---`);
      const z = await computeAltmanZDoublePrime(testCase.cik, year);
      const f = await computePiotroskiFScore(testCase.cik, year);
      const m = await computeBeneishMScore(testCase.cik, year);
      console.log(`  Altman Z":    ${formatOutcome(z)}`);
      console.log(`  Piotroski F:  ${formatOutcome(f)}`);
      console.log(`  Beneish M:    ${formatOutcome(m)}`);
    }
  }

  await pool.end();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('BACKTEST FAILED', err);
    process.exit(1);
  });
