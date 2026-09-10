import { UsGaapFact } from './sec';

// Generous upper bound on a plausible quarterly/annual dollar figure - not
// meant to be precise, just to catch obvious scaling/data-entry corruption
// (e.g. a value reported in cents instead of dollars) without flagging any
// real company's real numbers as false positives.
const MAX_PLAUSIBLE_MAGNITUDE = 5e13; // $50 trillion

const KNOWN_UNITS = new Set(['USD']);

export interface FactValidationResult {
  valid: boolean;
  reason?: string;
}

function isValidDateString(value: string | undefined): boolean {
  if (value === undefined) return true; // absent is fine (e.g. no period_start for instant facts)
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(value).getTime());
}

/**
 * Validates a single XBRL fact before it's written to filing_facts. Returns
 * why it failed so the reason can be recorded alongside the quarantined row.
 */
export function validateFact(unit: string, fact: UsGaapFact): FactValidationResult {
  if (typeof fact.val !== 'number' || !Number.isFinite(fact.val)) {
    return { valid: false, reason: `non-numeric value: ${String(fact.val)} (typeof ${typeof fact.val})` };
  }

  if (Math.abs(fact.val) > MAX_PLAUSIBLE_MAGNITUDE) {
    return { valid: false, reason: `value magnitude exceeds sanity threshold: ${fact.val}` };
  }

  if (!KNOWN_UNITS.has(unit)) {
    return { valid: false, reason: `unknown unit: ${unit}` };
  }

  if (!isValidDateString(fact.end) || !isValidDateString(fact.start)) {
    return { valid: false, reason: `invalid period date(s): start=${fact.start}, end=${fact.end}` };
  }

  return { valid: true };
}
