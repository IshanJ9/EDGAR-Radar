/**
 * The plain-English layer of the company page: score bands, "why" sentences
 * and the one-sentence summary, all computed from the API's numbers. Kept
 * pure and separate from the components so every sentence is unit-tested.
 * Thresholds are the backend's own (src/scoring.ts).
 */

export type Tone = 'good' | 'neutral' | 'warning' | 'serious' | 'critical';

export interface Band {
  label: string;
  tone: Tone;
  /** Where the value sits on the card's gauge, 0 to 1. */
  position: number;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const MINUS = '−';

/** $416.2B, −$14.3B, $2.5M, $950K. */
export function formatMoney(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? MINUS : '';
  const [divisor, suffix, digits] =
    abs >= 1e12 ? [1e12, 'T', 1] : abs >= 1e9 ? [1e9, 'B', 1] : abs >= 1e6 ? [1e6, 'M', 1] : abs >= 1e3 ? [1e3, 'K', 0] : [1, '', 0];
  return `${sign}$${(abs / divisor).toFixed(digits)}${suffix}`;
}

/** "Oct 31, 2025" from "2025-10-31" or "2025-10-31T00:00:00.000Z" - the calendar date as filed, in UTC. */
export function formatDate(isoDate: string): string {
  return new Date(`${isoDate.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** A score value as the card shows it: −2.30, not -2.295. */
export function formatScore(value: number, digits = 2): string {
  // The nudge keeps a value stored just below a half (2.295 is 2.29499…) from rounding down.
  const scale = 10 ** digits;
  const rounded = Math.round(Math.abs(value) * scale + 1e-6) / scale;
  return `${value < 0 && rounded !== 0 ? MINUS : ''}${rounded.toFixed(digits)}`;
}

// --- Altman Z″: Z″ > 2.6 safe, 1.1-2.6 grey zone, < 1.1 distress. Gauge 0..4.

export const ALTMAN_GAUGE = { min: 0, max: 4, cautionFrom: 1.1, safeFrom: 2.6 };

export function altmanBand(classification: string, value: number): Band {
  const position = clamp01((value - ALTMAN_GAUGE.min) / (ALTMAN_GAUGE.max - ALTMAN_GAUGE.min));
  if (classification === 'safe') return { label: 'Safe', tone: 'good', position };
  if (classification === 'distress') return { label: 'High risk', tone: 'critical', position };
  return { label: 'Caution', tone: 'warning', position };
}

export function altmanReasons(inputs: { workingCapital: number; retainedEarnings: number; ebit: number }): string[] {
  const { workingCapital, retainedEarnings, ebit } = inputs;
  return [
    workingCapital < 0
      ? `Short-term debts exceed short-term assets by ${formatMoney(-workingCapital)}.`
      : `Short-term assets exceed short-term debts by ${formatMoney(workingCapital)}.`,
    retainedEarnings < 0
      ? `Retained earnings are ${formatMoney(retainedEarnings)} - usually years of buybacks or dividends, or past losses.`
      : `It has kept ${formatMoney(retainedEarnings)} of past profits in the business.`,
    ebit < 0 ? `An operating loss of ${formatMoney(-ebit)} pulls the score down.` : `Operating profit of ${formatMoney(ebit)} pulls the score up.`,
  ];
}

// --- Piotroski F: 8-9 high quality, 3-7 moderate, 0-2 low quality.

export function piotroskiBand(classification: string): Omit<Band, 'position'> {
  if (classification === 'high-quality') return { label: 'Strong', tone: 'good' };
  if (classification === 'low-quality') return { label: 'Weak', tone: 'critical' };
  return { label: 'Moderate', tone: 'neutral' };
}

const PIOTROSKI_LABELS: [signal: string, label: string][] = [
  ['positiveROA', 'Profitable'],
  ['positiveCFO', 'Business generates cash'],
  ['cfoExceedsNetIncome', 'Cash beats reported profit'],
  ['decreasingLeverage', 'Less long-term debt'],
  ['noNewShares', 'No new shares issued'],
  ['improvingGrossMargin', 'Gross margin improving'],
  ['improvingROA', 'Return on assets improving'],
  ['improvingCurrentRatio', 'Short-term cushion improving'],
  ['improvingAssetTurnover', 'Sales per dollar of assets improving'],
];

/** The nine checks, passed ones first, each group in a fixed order. */
export function piotroskiChecks(signals: Record<string, boolean>): { label: string; passed: boolean }[] {
  const checks = PIOTROSKI_LABELS.map(([signal, label]) => ({ label, passed: signals[signal] === true }));
  return [...checks.filter((c) => c.passed), ...checks.filter((c) => !c.passed)];
}

// --- Beneish M: above −2.22 "likely manipulator" (Beneish 1999). Gauge −4..−1.

export const BENEISH_GAUGE = { min: -4, max: -1, threshold: -2.22 };

export function beneishBand(classification: string, value: number): Band {
  const position = clamp01((value - BENEISH_GAUGE.min) / (BENEISH_GAUGE.max - BENEISH_GAUGE.min));
  return classification === 'likely-manipulator'
    ? { label: 'Worth a closer look', tone: 'serious', position }
    : { label: 'None found', tone: 'good', position };
}

/**
 * Each index's average among the companies Beneish (1999) found had
 * manipulated earnings; a value above it is named. In the score's own order.
 */
const BENEISH_FLAGS: [index: string, threshold: number, sentence: string][] = [
  ['dsri', 1.465, 'Customers are taking much longer to pay.'],
  ['gmi', 1.193, 'Profit margins shrank sharply.'],
  ['aqi', 1.254, 'More of its assets are hard to value.'],
  ['sgi', 1.607, 'Sales grew unusually fast.'],
  ['depi', 1.077, 'It is depreciating its assets more slowly.'],
  ['sgai', 1.041, 'Overhead grew faster than sales.'],
  ['lvgi', 1.111, 'Its borrowing rose noticeably.'],
  ['tata', 0.031, 'Reported profit is not backed by cash.'],
];

export function beneishReasons(indices: Record<string, number>): string[] {
  const flagged = BENEISH_FLAGS.filter(([index, threshold]) => (indices[index] ?? 0) > threshold).map(([, , sentence]) => sentence);
  return flagged.length > 0 ? flagged : ['Sales, margins, spending and debt all moved within normal ranges year over year.'];
}

// --- Figures the backend calculated rather than read (F1b-2, F1b-3).

export function derivedNotes(derived: string[], liabilitiesDerived: boolean): string[] {
  const notes: string[] = [];
  if (derived.includes('grossProfit')) notes.push("Gross profit is revenue minus cost of revenue - the company doesn't report it directly.");
  if (derived.includes('sga')) notes.push('Overhead (SG&A) is selling and marketing plus general and administrative costs.');
  if (liabilitiesDerived || derived.includes('liabilities')) notes.push("Total liabilities are total assets minus shareholders' equity.");
  return notes;
}

// --- Why a score is missing.

const FIGURE_NAMES: Record<string, string> = {
  assets: 'total assets',
  liabilities: 'total liabilities',
  currentAssets: 'short-term assets',
  currentLiabilities: 'short-term debts',
  retainedEarnings: 'retained earnings',
  ebit: 'operating profit',
  equity: "shareholders' equity",
  revenue: 'revenue',
  netIncome: 'profit',
  operatingCashFlow: 'cash from operations',
  longTermDebt: 'long-term debt',
  shares: 'share count',
  grossProfit: 'gross profit',
  receivables: 'money owed by customers',
  ppe: 'property and equipment',
  depreciation: 'depreciation',
  sga: 'overhead costs',
};

/** "a", "a and b", "a, b and c". */
function joinWords(words: string[]): string {
  return words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}

export function unscoredReason(reason: string): string {
  if (/consecutive/i.test(reason)) return "The company's figures don't cover the same two consecutive years yet.";
  if (/no single fiscal year/i.test(reason)) return "The company's latest figures don't all cover the same year yet.";
  const listed = reason.match(/for:\s*([^.]+)\./);
  if (!listed) return 'Not enough figures to calculate it yet.';
  const figures = listed[1]!.split(',').map((f) => FIGURE_NAMES[f.trim()] ?? f.trim());
  const verb = figures.length === 1 ? "isn't" : "aren't";
  return /2 fiscal years/.test(reason)
    ? `It compares two years, and ${joinWords(figures)} ${verb} reported for both yet.`
    : `Not enough figures to calculate it: ${joinWords(figures)} ${verb} reported.`;
}

/** Banks, insurers, brokers and property trusts - for which these scores were never designed. */
export function isFinancialCompany(industry: string | null): boolean {
  return industry !== null && /bank|savings institution|insurance|security brokers|investment trust|finance services|credit institution/i.test(industry);
}

// --- The "In short" sentence.

interface Verdicts {
  altman?: { classification: string };
  piotroski?: { classification: string; value: number };
  beneish?: { classification: string };
}

/** Each scored verdict as a clause: positive or not, standalone and after "but". */
function clauses(v: Verdicts): { positive: boolean; main: string; afterBut: string }[] {
  const out: { positive: boolean; main: string; afterBut: string }[] = [];
  if (v.altman) {
    const zone = v.altman.classification === 'distress' ? 'high-risk' : 'caution';
    out.push(
      v.altman.classification === 'safe'
        ? { positive: true, main: 'has low bankruptcy risk', afterBut: 'it has low bankruptcy risk' }
        : { positive: false, main: `has a bankruptcy-risk score in the ${zone} zone`, afterBut: `its bankruptcy-risk score is in the ${zone} zone` },
    );
  }
  if (v.piotroski) {
    const n = v.piotroski.value;
    out.push(
      v.piotroski.classification === 'low-quality'
        ? { positive: false, main: `passes only ${n} of 9 financial-strength checks`, afterBut: `it passes only ${n} of 9 financial-strength checks` }
        : { positive: true, main: `passes ${n} of 9 financial-strength checks`, afterBut: `it passes ${n} of 9 financial-strength checks` },
    );
  }
  if (v.beneish) {
    out.push(
      v.beneish.classification === 'likely-manipulator'
        ? { positive: false, main: 'shows accounting patterns worth a closer look', afterBut: 'its accounting shows patterns worth a closer look' }
        : { positive: true, main: 'shows no accounting red flags', afterBut: 'it shows no accounting red flags' },
    );
  }
  return out;
}

export function summarize(name: string, verdicts: Verdicts): string | null {
  const all = clauses(verdicts);
  if (all.length === 0) return null;
  const good = all.filter((c) => c.positive);
  const bad = all.filter((c) => !c.positive);
  if (good.length === 0) return `${name} ${joinWords(bad.map((c) => c.main))}.`;
  const but = bad.length > 0 ? `, but ${joinWords(bad.map((c) => c.afterBut))}` : '';
  return `${name} ${joinWords(good.map((c) => c.main))}${but}.`;
}
