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
  COST_OF_REVENUE_TAGS,
  SELLING_MARKETING_TAGS,
  GENERAL_ADMIN_TAGS,
} from './sec';
import { getAnnualValues, AnnualValue } from './repositories/scoringRepository';

export type ScoreOutcome<TInputs> =
  | { status: 'ok'; value: number; classification: string; inputs: TInputs }
  | { status: 'insufficient-history'; reason: string };

/** How many years of each figure to read: enough to find a year (or a consecutive pair) that every figure has. */
const HISTORY_YEARS = 5;

/**
 * Fetches up to HISTORY_YEARS fiscal years of every concept a formula needs,
 * in one batch, newest first. `asOfFiscalYear` restricts to fiscal years at or
 * before it - used by Phase 5's back-testing step to compute a score for a
 * specific historical year instead of whatever's most recent today.
 */
async function fetchSeries(cik: string, concepts: Record<string, string[]>, asOfFiscalYear?: number): Promise<Record<string, AnnualValue[]>> {
  const entries = await Promise.all(
    Object.entries(concepts).map(async ([key, tags]) => [key, await getAnnualValues(cik, tags, HISTORY_YEARS, asOfFiscalYear)] as const),
  );
  return Object.fromEntries(entries);
}

/** `combine(a, b)` for every fiscal year both series have, newest first. */
export function combineByYear(a: AnnualValue[], b: AnnualValue[], combine: (x: number, y: number) => number): AnnualValue[] {
  const byYear = new Map(b.map((v) => [v.fiscalYear, v.value]));
  return a.filter((v) => byYear.has(v.fiscalYear)).map((v) => ({ fiscalYear: v.fiscalYear, value: combine(v.value, byYear.get(v.fiscalYear)!) }));
}

/** The newest fiscal year in a series, or -Infinity for an empty one. */
export function newestYear(values: AnnualValue[]): number {
  return Math.max(-Infinity, ...values.map((v) => v.fiscalYear));
}

/**
 * Derives a concept from two the company does report (post-Phase 7
 * hardening, step 3, F1b-2), and records the derivation in `derived`.
 *
 * The derived series is used when it reaches a newer year than the reported
 * one - not only when nothing is reported (F1b-3: Danaher, AT&T and T-Mobile
 * last reported total liabilities in 2010-2015, and that stale series used to
 * block a derivation covering every recent year). Like the freshest-tag rule
 * in sec.ts, the winner is used for every year: reported and derived values
 * are never mixed. The parts are read only when the reported series is behind
 * the newest year some other figure has - otherwise no derivation could give
 * a newer common year, and the cold company list would pay for the queries.
 */
async function deriveIfMissing(
  series: Record<string, AnnualValue[]>,
  key: string,
  derived: string[],
  parts: () => Promise<[AnnualValue[], AnnualValue[]]>,
  combine: (x: number, y: number) => number,
): Promise<void> {
  const reported = series[key] ?? [];
  const newestElsewhere = Math.max(
    ...Object.entries(series)
      .filter(([k]) => k !== key)
      .map(([, v]) => newestYear(v)),
  );
  if (reported.length > 0 && newestYear(reported) >= newestElsewhere) return;
  const [a, b] = await parts();
  const combined = combineByYear(a, b, combine);
  if (newestYear(combined) > newestYear(reported)) {
    series[key] = combined;
    derived.push(key);
  }
}

/** Gross profit = revenue - cost of revenue, for a company that reports cost of revenue but no GrossProfit. */
async function deriveGrossProfit(cik: string, series: Record<string, AnnualValue[]>, derived: string[], asOfFiscalYear?: number): Promise<void> {
  await deriveIfMissing(
    series,
    'grossProfit',
    derived,
    async () => [series.revenue!, await getAnnualValues(cik, COST_OF_REVENUE_TAGS, HISTORY_YEARS, asOfFiscalYear)],
    (revenue, cost) => revenue - cost,
  );
}

/**
 * SG&A = selling and marketing + general and administrative, for a company
 * that reports both but no combined figure. Only both: G&A alone would
 * understate SG&A, so a company reporting just one stays unscored.
 */
async function deriveSga(cik: string, series: Record<string, AnnualValue[]>, derived: string[], asOfFiscalYear?: number): Promise<void> {
  await deriveIfMissing(
    series,
    'sga',
    derived,
    async () => [
      await getAnnualValues(cik, SELLING_MARKETING_TAGS, HISTORY_YEARS, asOfFiscalYear),
      await getAnnualValues(cik, GENERAL_ADMIN_TAGS, HISTORY_YEARS, asOfFiscalYear),
    ],
    (sellingAndMarketing, generalAndAdmin) => sellingAndMarketing + generalAndAdmin,
  );
}

type YearSelection =
  | { ok: true; current: Record<string, AnnualValue>; prior: Record<string, AnnualValue> }
  | { ok: false; reason: string };

/**
 * Picks the most recent fiscal year that EVERY concept has - and, when
 * `needPrior`, the year immediately before it, also for every concept.
 *
 * Until post-Phase 7 hardening, step 3 (F1b-2) each concept's own latest
 * year(s) were taken independently, so a company missing one figure for its
 * newest year had that figure's older value paired with every other
 * figure's newer one - a ratio across two different years, with no error.
 */
function selectYears(series: Record<string, AnnualValue[]>, needPrior: boolean): YearSelection {
  const required = needPrior ? 2 : 1;
  const missing = Object.entries(series)
    .filter(([, v]) => v.length < required)
    .map(([k]) => k);
  if (missing.length > 0) {
    return {
      ok: false,
      reason: needPrior
        ? `Need 2 fiscal years of data; missing for: ${missing.join(', ')}.`
        : `Missing most-recent-fiscal-year data for: ${missing.join(', ')}.`,
    };
  }

  const yearSets = Object.values(series).map((v) => new Set(v.map((x) => x.fiscalYear)));
  const hasEverywhere = (fy: number) => yearSets.every((s) => s.has(fy));
  const candidates = [...yearSets[0]!].filter((fy) => hasEverywhere(fy) && (!needPrior || hasEverywhere(fy - 1))).sort((a, b) => b - a);
  const year = candidates[0];
  if (year === undefined) {
    const coverage = Object.entries(series)
      .map(([k, v]) => `${k} ${v.map((x) => x.fiscalYear).join('/')}`)
      .join('; ');
    return {
      ok: false,
      reason: needPrior
        ? `No two consecutive fiscal years are available for every figure (${coverage}).`
        : `No single fiscal year is available for every figure (${coverage}).`,
    };
  }

  const at = (fy: number) => Object.fromEntries(Object.entries(series).map(([k, v]) => [k, v.find((x) => x.fiscalYear === fy)!]));
  return { ok: true, current: at(year), prior: needPrior ? at(year - 1) : {} };
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

export async function computeAltmanZDoublePrime(cik: string, asOfFiscalYear?: number): Promise<ScoreOutcome<AltmanZInputs>> {
  const series = await fetchSeries(
    cik,
    {
      assets: ASSETS_TAGS,
      liabilities: LIABILITIES_TAGS,
      currentAssets: CURRENT_ASSETS_TAGS,
      currentLiabilities: CURRENT_LIABILITIES_TAGS,
      retainedEarnings: RETAINED_EARNINGS_TAGS,
      ebit: OPERATING_INCOME_TAGS,
      equity: STOCKHOLDERS_EQUITY_TAGS,
    },
    asOfFiscalYear,
  );

  // Not every company tags a single combined "Liabilities" total in XBRL -
  // confirmed for real against AbbVie, which reports Assets and
  // StockholdersEquity every year but never a consolidated Liabilities
  // figure. Derive it from the fundamental balance-sheet identity
  // (Assets = Liabilities + Equity, which always holds by definition),
  // year by year, rather than treating this as missing data.
  const derived: string[] = [];
  await deriveIfMissing(series, 'liabilities', derived, async () => [series.assets!, series.equity!], (assets, equity) => assets - equity);
  const liabilitiesDerived = derived.includes('liabilities');

  const selection = selectYears(series, false);
  if (!selection.ok) {
    return { status: 'insufficient-history', reason: selection.reason };
  }

  const { assets, liabilities, currentAssets, currentLiabilities, retainedEarnings, ebit, equity } = selection.current;

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
  /** Concepts computed from others because the company doesn't report them, e.g. ["grossProfit"]. */
  derived: string[];
}

export async function computePiotroskiFScore(cik: string, asOfFiscalYear?: number): Promise<ScoreOutcome<PiotroskiInputs>> {
  const series = await fetchSeries(
    cik,
    {
      assets: ASSETS_TAGS,
      currentAssets: CURRENT_ASSETS_TAGS,
      currentLiabilities: CURRENT_LIABILITIES_TAGS,
      longTermDebt: LONG_TERM_DEBT_TAGS,
      cfo: OPERATING_CASH_FLOW_TAGS,
      netIncome: NET_INCOME_TAGS,
      shares: SHARES_OUTSTANDING_TAGS,
      grossProfit: GROSS_PROFIT_TAGS,
      revenue: REVENUE_TAGS,
    },
    asOfFiscalYear,
  );

  const derived: string[] = [];
  await deriveGrossProfit(cik, series, derived, asOfFiscalYear);

  const selection = selectYears(series, true);
  if (!selection.ok) {
    return { status: 'insufficient-history', reason: selection.reason };
  }

  const { assets: assetsT, currentAssets: caT, currentLiabilities: clT, longTermDebt: ltdT, cfo: cfoT, netIncome: niT, shares: sharesT, grossProfit: gpT, revenue: revT } =
    selection.current;
  const { assets: assetsP, currentAssets: caP, currentLiabilities: clP, longTermDebt: ltdP, netIncome: niP, shares: sharesP, grossProfit: gpP, revenue: revP } =
    selection.prior;

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
    inputs: { fiscalYearCurrent: assetsT!.fiscalYear, fiscalYearPrior: assetsP!.fiscalYear, signals, derived },
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
  /** Concepts computed from others because the company doesn't report them, e.g. ["grossProfit", "sga"]. */
  derived: string[];
}

export async function computeBeneishMScore(cik: string, asOfFiscalYear?: number): Promise<ScoreOutcome<BeneishInputs>> {
  const series = await fetchSeries(
    cik,
    {
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
    },
    asOfFiscalYear,
  );

  const derived: string[] = [];
  await deriveGrossProfit(cik, series, derived, asOfFiscalYear);
  await deriveSga(cik, series, derived, asOfFiscalYear);

  const selection = selectYears(series, true);
  if (!selection.ok) {
    return { status: 'insufficient-history', reason: selection.reason };
  }

  const c = selection.current;
  const p = selection.prior;
  const [assetsT, caT, clT, ltdT, cfoT, niT, revT, gpT, recT, ppeT, depT, sgaT] = [c.assets, c.currentAssets, c.currentLiabilities, c.longTermDebt, c.cfo, c.netIncome, c.revenue, c.grossProfit, c.receivables, c.ppe, c.depreciation, c.sga];
  const [assetsP, caP, clP, ltdP, revP, gpP, recP, ppeP, depP, sgaP] = [p.assets, p.currentAssets, p.currentLiabilities, p.longTermDebt, p.revenue, p.grossProfit, p.receivables, p.ppe, p.depreciation, p.sga];

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
      derived,
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
