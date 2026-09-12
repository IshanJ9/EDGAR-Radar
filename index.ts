import 'dotenv/config';
import { fetchCompanyFacts, mostRecentFact, padCik, CompanyFactsNotFoundError, REVENUE_TAGS, NET_INCOME_TAGS } from './src/sec';

async function main() {
  const cik = process.argv[2];
  if (!cik) {
    console.error('Usage: npx ts-node index.ts <CIK>');
    process.exit(1);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mirrors fetchCompanyFacts's own Promise<any> return (see sec.ts): SEC's raw XBRL JSON is genuinely untyped here, not lazily typed.
  let data: any;
  try {
    data = await fetchCompanyFacts(cik);
  } catch (err) {
    if (err instanceof CompanyFactsNotFoundError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  console.log(`GET companyfacts for CIK ${padCik(cik)} -> entityName: ${data.entityName}`);

  const revenue = mostRecentFact(data, REVENUE_TAGS);
  const netIncome = mostRecentFact(data, NET_INCOME_TAGS);

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
