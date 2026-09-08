import 'dotenv/config';

const CONTACT_EMAIL = process.env.EDGAR_CONTACT_EMAIL;
if (!CONTACT_EMAIL) {
  console.error('Missing EDGAR_CONTACT_EMAIL in .env (see .env.example).');
  process.exit(1);
}
const USER_AGENT = `EDGAR Radar (${CONTACT_EMAIL})`;

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
  const data = await response.json();
  console.log('entityName:', data.entityName);
}

main();
