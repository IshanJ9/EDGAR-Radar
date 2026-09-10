import 'dotenv/config';
import { writeFileSync } from 'fs';
import path from 'path';
import { padCik } from '../src/sec';

// A curated list of ~200 well-known large-cap US company tickers, spread
// across sectors. This is a static snapshot (per Phase 2 decision), not a
// live index feed - it will drift from reality over time and can be
// re-curated by editing this list and re-running this script.
const TICKERS = [
  // Technology
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA', 'TSLA', 'AVGO', 'ORCL',
  'CRM', 'ADBE', 'CSCO', 'ACN', 'IBM', 'INTC', 'AMD', 'QCOM', 'TXN', 'INTU',
  'NOW', 'AMAT', 'ADI', 'LRCX', 'MU', 'PANW', 'SNPS', 'CDNS', 'KLAC', 'PYPL',
  // Financials
  'JPM', 'BAC', 'WFC', 'C', 'GS', 'MS', 'SCHW', 'BLK', 'AXP', 'SPGI',
  'CB', 'PGR', 'MRSH', 'CME', 'ICE', 'AON', 'USB', 'PNC', 'TFC', 'COF',
  'BNY', 'TRV', 'ALL', 'MET', 'AIG',
  // Healthcare
  'UNH', 'JNJ', 'LLY', 'ABBV', 'MRK', 'PFE', 'TMO', 'ABT', 'DHR', 'BMY',
  'AMGN', 'MDT', 'GILD', 'ISRG', 'VRTX', 'CI', 'ELV', 'HCA', 'SYK', 'BSX',
  'REGN', 'ZTS', 'CVS', 'HUM', 'BDX',
  // Consumer Discretionary
  'HD', 'MCD', 'NKE', 'LOW', 'SBUX', 'TJX', 'BKNG', 'CMG', 'MAR', 'GM',
  'F', 'ORLY', 'AZO', 'YUM', 'ROST', 'HLT', 'DHI', 'LEN', 'EBAY',
  // Consumer Staples
  'PG', 'KO', 'PEP', 'COST', 'WMT', 'PM', 'MO', 'MDLZ', 'CL', 'KMB',
  'GIS', 'STZ', 'KHC', 'SYY', 'ADM',
  // Energy
  'XOM', 'CVX', 'COP', 'SLB', 'EOG', 'MPC', 'PSX', 'VLO', 'OXY', 'WMB',
  'KMI',
  // Industrials
  'GE', 'CAT', 'HON', 'UPS', 'RTX', 'BA', 'LMT', 'DE', 'UNP', 'ADP',
  'NOC', 'GD', 'ETN', 'ITW', 'EMR', 'PH', 'CSX', 'NSC', 'WM', 'FDX',
  // Communication Services
  'NFLX', 'DIS', 'CMCSA', 'VZ', 'T', 'TMUS', 'CHTR', 'TTWO', 'WBD', 'MTCH',
  // Utilities
  'NEE', 'DUK', 'SO', 'D', 'AEP', 'EXC', 'SRE', 'XEL', 'ED', 'PEG',
  // Real Estate
  'AMT', 'PLD', 'EQIX', 'CCI', 'PSA', 'SPG', 'O', 'WELL', 'DLR',
  // Materials
  'LIN', 'APD', 'SHW', 'ECL', 'FCX', 'NEM', 'DD', 'NUE', 'VMC', 'MLM',
  // Rounding out to ~200
  'MSCI', 'MCO', 'FIS', 'GPN', 'ADSK', 'WDAY', 'FTNT', 'ROP', 'CTAS', 'PAYX',
  'APH', 'TEL', 'MSI',
];

interface SecTickerEntry {
  cik_str: number;
  ticker: string;
  title: string;
}

interface CompanyUniverseEntry {
  cik: string;
  ticker: string;
  name: string;
}

async function main() {
  const contactEmail = process.env.EDGAR_CONTACT_EMAIL;
  if (!contactEmail) {
    throw new Error('Missing EDGAR_CONTACT_EMAIL in .env');
  }

  const response = await fetch('https://www.sec.gov/files/company_tickers.json', {
    headers: { 'User-Agent': `EDGAR Radar (${contactEmail})` },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch company_tickers.json: ${response.status}`);
  }
  const raw: Record<string, SecTickerEntry> = await response.json();

  const byTicker = new Map<string, SecTickerEntry>();
  for (const entry of Object.values(raw)) {
    byTicker.set(entry.ticker.toUpperCase(), entry);
  }

  const resolved: CompanyUniverseEntry[] = [];
  const missing: string[] = [];

  const seen = new Set<string>();
  for (const ticker of TICKERS) {
    if (seen.has(ticker)) {
      console.warn(`Duplicate ticker in list, skipping: ${ticker}`);
      continue;
    }
    seen.add(ticker);

    const match = byTicker.get(ticker);
    if (!match) {
      missing.push(ticker);
      continue;
    }
    resolved.push({ cik: padCik(String(match.cik_str)), ticker, name: match.title });
  }

  resolved.sort((a, b) => a.ticker.localeCompare(b.ticker));

  const cikCounts = new Map<string, string[]>();
  for (const entry of resolved) {
    cikCounts.set(entry.cik, [...(cikCounts.get(entry.cik) ?? []), entry.ticker]);
  }
  const duplicateCiks = [...cikCounts.entries()].filter(([, tickers]) => tickers.length > 1);
  if (duplicateCiks.length > 0) {
    console.warn(
      `Warning: ${duplicateCiks.length} CIK(s) appear under more than one ticker (likely dual share classes of the same company):`,
    );
    for (const [cik, tickers] of duplicateCiks) {
      console.warn(`  ${cik}: ${tickers.join(', ')}`);
    }
  }

  const outPath = path.join(__dirname, '..', 'data', 'company-universe.json');
  writeFileSync(outPath, JSON.stringify(resolved, null, 2) + '\n');

  console.log(`Resolved ${resolved.length}/${TICKERS.length} tickers to CIKs.`);
  if (missing.length > 0) {
    console.log(`Missing (not found in SEC's ticker file): ${missing.join(', ')}`);
  }
  console.log(`Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
