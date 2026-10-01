import type { Company, RatingSummary } from './api';
import { altmanBand, formatScore, piotroskiBand, type Tone } from './explain';

export type ScoreName = 'altmanZ' | 'piotroskiF' | 'beneishM';
export const SCORE_NAMES: ScoreName[] = ['altmanZ', 'piotroskiF', 'beneishM'];

export interface Chip {
  label: string;
  tone: Tone;
  value: string;
}

/** A score in the company list: a short verdict and its number, or null when it isn't available. */
export function ratingChip(score: ScoreName, rating: RatingSummary | undefined): Chip | null {
  if (!rating || rating.status !== 'ok') return null;
  if (score === 'altmanZ') return { ...pick(altmanBand(rating.classification, rating.value)), value: formatScore(rating.value) };
  if (score === 'piotroskiF') return { ...piotroskiBand(rating.classification), value: `${rating.value}/9` };
  return rating.classification === 'likely-manipulator'
    ? { label: 'Look closer', tone: 'serious', value: formatScore(rating.value) }
    : { label: 'None found', tone: 'good', value: formatScore(rating.value) };
}

const pick = ({ label, tone }: { label: string; tone: Tone }) => ({ label, tone });

export function scoredCount(company: Company): number {
  return SCORE_NAMES.filter((s) => company.ratings[s]?.status === 'ok').length;
}

/** Caution or high bankruptcy risk, weak financial strength, or an accounting flag. */
export function hasConcern(company: Company): boolean {
  const { altmanZ, piotroskiF, beneishM } = company.ratings;
  return (
    (altmanZ?.status === 'ok' && altmanZ.classification !== 'safe') ||
    (piotroskiF?.status === 'ok' && piotroskiF.classification === 'low-quality') ||
    (beneishM?.status === 'ok' && beneishM.classification === 'likely-manipulator')
  );
}

export function coverage(companies: Company[]): { total: number; allThree: number; none: number } {
  const counts = companies.map(scoredCount);
  return { total: companies.length, allThree: counts.filter((n) => n === 3).length, none: counts.filter((n) => n === 0).length };
}
