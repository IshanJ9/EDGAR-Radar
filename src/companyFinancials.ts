import {
  ASSETS_TAGS,
  LIABILITIES_TAGS,
  LONG_TERM_DEBT_TAGS,
  NET_INCOME_TAGS,
  OPERATING_CASH_FLOW_TAGS,
  REVENUE_TAGS,
  STOCKHOLDERS_EQUITY_TAGS,
  padCik,
} from './sec';
import { AnnualValue, getAnnualValues } from './repositories/scoringRepository';
import { getLatestAnnualReportFiledDate } from './repositories/companyRepository';
import { combineByYear, newestYear } from './scoring';

/** Enough years for a trend on the company page, and what ingestion keeps. */
const YEARS = 5;

export interface CompanyFinancials {
  cik: string;
  /** YYYY-MM-DD, or null if no annual report is stored. */
  latestAnnualReportFiled: string | null;
  revenue: AnnualValue[];
  netIncome: AnnualValue[];
  totalAssets: AnnualValue[];
  totalLiabilities: AnnualValue[];
  /** True when liabilities are assets minus equity because the company reports no recent total. */
  liabilitiesDerived: boolean;
  longTermDebt: AnnualValue[];
  operatingCashFlow: AnnualValue[];
}

const oldestFirst = (values: AnnualValue[]) => [...values].sort((a, b) => a.fiscalYear - b.fiscalYear);

/**
 * A company's headline annual figures for the company page's charts
 * (post-Phase 7 hardening, step 3, F3). Each figure comes from
 * `getAnnualValues` with the same tag lists the scores use, so a chart and a
 * score never disagree about which figure is "revenue". Series are oldest
 * first, the order a chart draws them.
 *
 * Liabilities follow the Altman score's rule (F1b-3): when the company
 * reports no total, or only an older one, they are assets minus equity for
 * every year both exist - never a mix of reported and derived years.
 */
export async function getCompanyFinancials(cik: string): Promise<CompanyFinancials> {
  const paddedCik = padCik(cik);
  const annual = (tags: string[]) => getAnnualValues(paddedCik, tags, YEARS);
  const [revenue, netIncome, totalAssets, reportedLiabilities, equity, longTermDebt, operatingCashFlow, latestAnnualReportFiled] = await Promise.all([
    annual(REVENUE_TAGS),
    annual(NET_INCOME_TAGS),
    annual(ASSETS_TAGS),
    annual(LIABILITIES_TAGS),
    annual(STOCKHOLDERS_EQUITY_TAGS),
    annual(LONG_TERM_DEBT_TAGS),
    annual(OPERATING_CASH_FLOW_TAGS),
    getLatestAnnualReportFiledDate(paddedCik),
  ]);

  const derivedLiabilities = combineByYear(totalAssets, equity, (assets, eq) => assets - eq);
  const liabilitiesDerived = newestYear(derivedLiabilities) > newestYear(reportedLiabilities);

  return {
    cik: paddedCik,
    latestAnnualReportFiled,
    revenue: oldestFirst(revenue),
    netIncome: oldestFirst(netIncome),
    totalAssets: oldestFirst(totalAssets),
    totalLiabilities: oldestFirst(liabilitiesDerived ? derivedLiabilities : reportedLiabilities),
    liabilitiesDerived,
    longTermDebt: oldestFirst(longTermDebt),
    operatingCashFlow: oldestFirst(operatingCashFlow),
  };
}
