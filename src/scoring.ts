import {
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
  REVENUE_TAGS,
  NET_INCOME_TAGS,
} from './sec';
import { getAnnualValues, AnnualValue } from './repositories/scoringRepository';

export type ScoreOutcome<TInputs> =
  | { status: 'ok'; value: number; classification: string; inputs: TInputs }
  | { status: 'insufficient-history'; reason: string };

/** Fetches 2 fiscal years for every tag concept a formula needs, in one batch. */
async function fetchTwoYears(cik: string, concepts: Record<string, string[]>): Promise<Record<string, AnnualValue[]>> {
  const entries = await Promise.all(
    Object.entries(concepts).map(async ([key, tags]) => [key, await getAnnualValues(cik, tags, 2)] as const),
  );
  return Object.fromEntries(entries);
}

function missingConcepts(values: Record<string, AnnualValue[]>, requiredYears: 1 | 2): string[] {
  return Object.entries(values)
    .filter(([, v]) => v.length < requiredYears)
    .map(([k]) => k);
}

// ---------------------------------------------------------------------------
// Altman Z" (Zeta double-prime) - the private-firm/emerging-market variant
// of the Altman Z-Score, substituting Book Value of Equity for Market Value
// of Equity so it's computable entirely from XBRL data (the original public-
// company formula needs a stock price, which isn't a filing fact and isn't
// available anywhere in this project). Needs only the most recent fiscal
// year - no year-over-year comparison in this formula.
//
// Z" = 6.56*X1 + 3.26*X2 + 6.72*X3 + 1.05*X4
//   X1 = Working Capital / Total Assets
//   X2 = Retained Earnings / Total Assets
//   X3 = EBIT / Total Assets            (EBIT proxied by OperatingIncomeLoss)
//   X4 = Book Value of Equity / Total Liabilities
// Zones: Z" > 2.6 safe, 1.1-2.6 grey zone, < 1.1 distress.
// ---------------------------------------------------------------------------
export interface AltmanZInputs {
  fiscalYear: number;
  workingCapital: number;
  totalAssets: number;
  retainedEarnings: number;
  ebit: number;
  bookValueOfEquity: number;
  totalLiabilities: number;
  liabilitiesDerived: boolean;
}

export async function computeAltmanZDoublePrime(cik: string): Promise<ScoreOutcome<AltmanZInputs>> {
  const values = await fetchTwoYears(cik, {
    assets: ASSETS_TAGS,
    liabilities: LIABILITIES_TAGS,
    currentAssets: CURRENT_ASSETS_TAGS,
    currentLiabilities: CURRENT_LIABILITIES_TAGS,
    retainedEarnings: RETAINED_EARNINGS_TAGS,
    ebit: OPERATING_INCOME_TAGS,
    equity: STOCKHOLDERS_EQUITY_TAGS,
  });

  // Not every company tags a single combined "Liabilities" total in XBRL -
  // confirmed for real against AbbVie, which reports Assets and
  // StockholdersEquity every year but never a consolidated Liabilities
  // figure. Derive it from the fundamental balance-sheet identity
  // (Assets = Liabilities + Equity, which always holds by definition)
  // rather than treating this as missing data, when both of those are
  // available for the same fiscal year.
  let liabilitiesDerived = false;
  if ((values.liabilities?.length ?? 0) === 0 && (values.assets?.length ?? 0) > 0 && (values.equity?.length ?? 0) > 0) {
    const [assetsForDerivation] = values.assets!;
    const [equityForDerivation] = values.equity!;
    if (assetsForDerivation!.fiscalYear === equityForDerivation!.fiscalYear) {
      values.liabilities = [{ fiscalYear: assetsForDerivation!.fiscalYear, value: assetsForDerivation!.value - equityForDerivation!.value }];
      liabilitiesDerived = true;
    }
  }

  const missing = missingConcepts(values, 1);
  if (missing.length > 0) {
    return { status: 'insufficient-history', reason: `Missing most-recent-fiscal-year data for: ${missing.join(', ')}.` };
  }

  const [assets] = values.assets!;
  const [liabilities] = values.liabilities!;
  const [currentAssets] = values.currentAssets!;
  const [currentLiabilities] = values.currentLiabilities!;
  const [retainedEarnings] = values.retainedEarnings!;
  const [ebit] = values.ebit!;
  const [equity] = values.equity!;

  if (assets!.value === 0 || liabilities!.value === 0) {
    return { status: 'insufficient-history', reason: 'Total assets or total liabilities is zero - cannot compute ratios.' };
  }

  const workingCapital = currentAssets!.value - currentLiabilities!.value;
  const x1 = workingCapital / assets!.value;
  const x2 = retainedEarnings!.value / assets!.value;
  const x3 = ebit!.value / assets!.value;
  const x4 = equity!.value / liabilities!.value;

  const z = 6.56 * x1 + 3.26 * x2 + 6.72 * x3 + 1.05 * x4;
  const classification = z > 2.6 ? 'safe' : z > 1.1 ? 'grey-zone' : 'distress';

  return {
    status: 'ok',
    value: Number(z.toFixed(3)),
    classification,
    inputs: {
      fiscalYear: assets!.fiscalYear,
      workingCapital,
      totalAssets: assets!.value,
      retainedEarnings: retainedEarnings!.value,
      ebit: ebit!.value,
      bookValueOfEquity: equity!.value,
      totalLiabilities: liabilities!.value,
      liabilitiesDerived,
    },
  };
}

// ---------------------------------------------------------------------------
// Piotroski F-Score - 9 binary signals (1 point each, 0-9 total) comparing
// the current fiscal year (t) against the prior one (t-1). A score of 8-9
// is conventionally read as high quality; 0-2 as low quality.
// ---------------------------------------------------------------------------
export interface PiotroskiInputs {
  fiscalYearCurrent: number;
  fiscalYearPrior: number;
  signals: {
    positiveROA: boolean;
    positiveCFO: boolean;
    improvingROA: boolean;
    cfoExceedsNetIncome: boolean;
    decreasingLeverage: boolean;
    improvingCurrentRatio: boolean;
    noNewShares: boolean;
    improvingGrossMargin: boolean;
    improvingAssetTurnover: boolean;
  };
}

export async function computePiotroskiFScore(cik: string): Promise<ScoreOutcome<PiotroskiInputs>> {
  const values = await fetchTwoYears(cik, {
    assets: ASSETS_TAGS,
    currentAssets: CURRENT_ASSETS_TAGS,
    currentLiabilities: CURRENT_LIABILITIES_TAGS,
    longTermDebt: LONG_TERM_DEBT_TAGS,
    cfo: OPERATING_CASH_FLOW_TAGS,
    netIncome: NET_INCOME_TAGS,
    shares: SHARES_OUTSTANDING_TAGS,
    grossProfit: GROSS_PROFIT_TAGS,
    revenue: REVENUE_TAGS,
  });

  const missing = missingConcepts(values, 2);
  if (missing.length > 0) {
    return { status: 'insufficient-history', reason: `Need 2 fiscal years of data; missing for: ${missing.join(', ')}.` };
  }

  const [assetsT, assetsP] = values.assets!;
  const [caT, caP] = values.currentAssets!;
  const [clT, clP] = values.currentLiabilities!;
  const [ltdT, ltdP] = values.longTermDebt!;
  const [cfoT] = values.cfo!;
  const [niT, niP] = values.netIncome!;
  const [sharesT, sharesP] = values.shares!;
  const [gpT, gpP] = values.grossProfit!;
  const [revT, revP] = values.revenue!;

  if ([assetsT, assetsP, revT, revP].some((v) => v!.value === 0)) {
    return { status: 'insufficient-history', reason: 'Total assets or revenue is zero in one of the two fiscal years - cannot compute ratios.' };
  }

  const roaT = niT!.value / assetsT!.value;
  const roaP = niP!.value / assetsP!.value;
  const leverageT = ltdT!.value / assetsT!.value;
  const leverageP = ltdP!.value / assetsP!.value;
  const currentRatioT = caT!.value / clT!.value;
  const currentRatioP = caP!.value / clP!.value;
  const grossMarginT = gpT!.value / revT!.value;
  const grossMarginP = gpP!.value / revP!.value;
  const turnoverT = revT!.value / assetsT!.value;
  const turnoverP = revP!.value / assetsP!.value;

  const signals = {
    positiveROA: roaT > 0,
    positiveCFO: cfoT!.value > 0,
    improvingROA: roaT > roaP,
    cfoExceedsNetIncome: cfoT!.value > niT!.value,
    decreasingLeverage: leverageT < leverageP,
    improvingCurrentRatio: currentRatioT > currentRatioP,
    noNewShares: sharesT!.value <= sharesP!.value,
    improvingGrossMargin: grossMarginT > grossMarginP,
    improvingAssetTurnover: turnoverT > turnoverP,
  };

  const score = Object.values(signals).filter(Boolean).length;
  const classification = score >= 8 ? 'high-quality' : score <= 2 ? 'low-quality' : 'moderate';

  return {
    status: 'ok',
    value: score,
    classification,
    inputs: { fiscalYearCurrent: assetsT!.fiscalYear, fiscalYearPrior: assetsP!.fiscalYear, signals },
  };
}

// ---------------------------------------------------------------------------
// Beneish M-Score - 8 indices comparing fiscal year t to t-1, combined into
// a single score. The original (Beneish 1999) threshold of -2.22 is used
// here as the "likely manipulator" cutoff; some later work uses -1.78 for a
// different false-positive/false-negative tradeoff - -2.22 is used as the
// more commonly cited textbook value, documented here rather than silently
// picked.
//
// M = -4.84 + 0.92*DSRI + 0.528*GMI + 0.404*AQI + 0.892*SGI + 0.115*DEPI
//     - 0.172*SGAI + 4.679*TATA - 0.327*LVGI
// ---------------------------------------------------------------------------
export interface BeneishInputs {
  fiscalYearCurrent: number;
  fiscalYearPrior: number;
  indices: {
    dsri: number;
    gmi: number;
    aqi: number;
    sgi: number;
    depi: number;
    sgai: number;
    tata: number;
    lvgi: number;
  };
}

export async function computeBeneishMScore(cik: string): Promise<ScoreOutcome<BeneishInputs>> {
  const values = await fetchTwoYears(cik, {
    assets: ASSETS_TAGS,
    currentAssets: CURRENT_ASSETS_TAGS,
    currentLiabilities: CURRENT_LIABILITIES_TAGS,
    longTermDebt: LONG_TERM_DEBT_TAGS,
    cfo: OPERATING_CASH_FLOW_TAGS,
    netIncome: NET_INCOME_TAGS,
    revenue: REVENUE_TAGS,
    grossProfit: GROSS_PROFIT_TAGS,
    receivables: RECEIVABLES_TAGS,
    ppe: PPE_TAGS,
    depreciation: DEPRECIATION_TAGS,
    sga: SGA_TAGS,
  });

  const missing = missingConcepts(values, 2);
  if (missing.length > 0) {
    return { status: 'insufficient-history', reason: `Need 2 fiscal years of data; missing for: ${missing.join(', ')}.` };
  }

  const [assetsT, assetsP] = values.assets!;
  const [caT, caP] = values.currentAssets!;
  const [clT, clP] = values.currentLiabilities!;
  const [ltdT, ltdP] = values.longTermDebt!;
  const [cfoT] = values.cfo!;
  const [niT] = values.netIncome!;
  const [revT, revP] = values.revenue!;
  const [gpT, gpP] = values.grossProfit!;
  const [recT, recP] = values.receivables!;
  const [ppeT, ppeP] = values.ppe!;
  const [depT, depP] = values.depreciation!;
  const [sgaT, sgaP] = values.sga!;

  const denominatorsAreNonZero =
    revT!.value !== 0 &&
    revP!.value !== 0 &&
    assetsT!.value !== 0 &&
    assetsP!.value !== 0 &&
    depT!.value + ppeT!.value !== 0 &&
    depP!.value + ppeP!.value !== 0;
  if (!denominatorsAreNonZero) {
    return { status: 'insufficient-history', reason: 'One or more required denominators (revenue, assets, depreciation+PP&E) is zero in one of the two fiscal years.' };
  }

  const dsri = (recT!.value / revT!.value) / (recP!.value / revP!.value);
  const grossMarginT = gpT!.value / revT!.value;
  const grossMarginP = gpP!.value / revP!.value;
  const gmi = grossMarginP / grossMarginT;
  const aqiT = 1 - (caT!.value + ppeT!.value) / assetsT!.value;
  const aqiP = 1 - (caP!.value + ppeP!.value) / assetsP!.value;
  const aqi = aqiT / aqiP;
  const sgi = revT!.value / revP!.value;
  const depRateT = depT!.value / (depT!.value + ppeT!.value);
  const depRateP = depP!.value / (depP!.value + ppeP!.value);
  const depi = depRateP / depRateT;
  const sgai = (sgaT!.value / revT!.value) / (sgaP!.value / revP!.value);
  const tata = (niT!.value - cfoT!.value) / assetsT!.value;
  const leverageT = (ltdT!.value + clT!.value) / assetsT!.value;
  const leverageP = (ltdP!.value + clP!.value) / assetsP!.value;
  const lvgi = leverageT / leverageP;

  const m = -4.84 + 0.92 * dsri + 0.528 * gmi + 0.404 * aqi + 0.892 * sgi + 0.115 * depi - 0.172 * sgai + 4.679 * tata - 0.327 * lvgi;
  const classification = m > -2.22 ? 'likely-manipulator' : 'unlikely-manipulator';

  return {
    status: 'ok',
    value: Number(m.toFixed(3)),
    classification,
    inputs: {
      fiscalYearCurrent: assetsT!.fiscalYear,
      fiscalYearPrior: assetsP!.fiscalYear,
      indices: {
        dsri: Number(dsri.toFixed(4)),
        gmi: Number(gmi.toFixed(4)),
        aqi: Number(aqi.toFixed(4)),
        sgi: Number(sgi.toFixed(4)),
        depi: Number(depi.toFixed(4)),
        sgai: Number(sgai.toFixed(4)),
        tata: Number(tata.toFixed(4)),
        lvgi: Number(lvgi.toFixed(4)),
      },
    },
  };
}
