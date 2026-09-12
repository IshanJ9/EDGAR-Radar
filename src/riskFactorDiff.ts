import { extractRiskFactorsSection } from './riskFactors';
import { embedTexts, cosineSimilarity } from './embeddings';

// Merge short fragments (a bolded lead-in sentence, a stray heading, a
// page-footer artifact from plaintext extraction) forward into the next
// substantive chunk, rather than embedding/diffing them as their own
// meaningless unit.
const MIN_CHUNK_CHARS = 150;
// Split anything longer at sentence boundaries so nothing silently gets cut
// off mid-thought before being embedded. An earlier version of this comment
// justified 900 by a 256-token model limit; that limit was wrong - the model
// actually truncates at 512 tokens (measured, see src/embeddings.ts). At a
// measured ~5.15 characters/token on real filing prose, 900 characters is
// only ~175 tokens, so this sits roughly 2.9x under the real ceiling. The
// value is kept at 900 anyway: it is safe under either limit, and it is
// chosen for *semantic* granularity - a chunk should be about one risk
// factor, not the largest block the model will physically accept. There is
// headroom to raise it if larger units ever prove more useful.
const MAX_CHUNK_CHARS = 900;

// Known precision floor on both thresholds: the quantized embedding model
// carries up to ~0.025 of similarity error versus fp32 weights (measured -
// see src/embeddings.ts). The 0.92 threshold is comparatively safe, since
// that error shrinks to ~0.001 on genuinely near-identical text, but a pair
// whose true similarity sits within ~0.025 of 0.60 can land on either side
// of the 'modified'/'new' line. Treat classifications near 0.60 as
// low-confidence rather than authoritative.
const UNCHANGED_THRESHOLD = 0.92;
const MODIFIED_THRESHOLD = 0.6;

// Pagination artifacts from PDF/HTML-to-text conversion (src/filingText.ts)
// that would otherwise get merged *into* a real chunk's text rather than
// removed, quietly polluting its embedding. Confirmed as a real, pervasive
// problem, not theoretical: found via a manual accuracy spot-check (Phase 5
// closing) that a genuinely word-for-word-identical Apple risk-factor
// paragraph was scored only 0.78 similarity (classified 'modified' instead
// of 'unchanged') purely because a page header ("Apple Inc. | 2024 Form
// 10-K | 16") had attached to it - and standalone page-number lines alone
// appear 56-469 times per document across every company checked, not just
// Apple's specific header style.
const PAGE_NUMBER_LINE = /^\d{1,4}$/;
const PIPE_DELIMITED_HEADER_LINE = /^.{0,80}\|.{0,60}\|\s*\d{1,4}\s*$/;
// A second, independently-confirmed recurring artifact found while checking
// whether the page-number fix generalized beyond Apple: a running
// "Table of Contents" page header, appearing as its own line up to 97 times
// in a single document (Alphabet) - not present in every company's filing
// (Apple/Microsoft's real text has none), but real and pervasive enough in
// the ones that do have it to be worth stripping the same way.
const TABLE_OF_CONTENTS_LINE = /^table of contents$/i;

export function chunkRiskFactorText(text: string): string[] {
  const lines = text
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !PAGE_NUMBER_LINE.test(s) && !PIPE_DELIMITED_HEADER_LINE.test(s) && !TABLE_OF_CONTENTS_LINE.test(s));

  const merged: string[] = [];
  let buffer = '';
  for (const line of lines) {
    buffer = buffer ? `${buffer} ${line}` : line;
    if (buffer.length >= MIN_CHUNK_CHARS) {
      merged.push(buffer);
      buffer = '';
    }
  }
  if (buffer) {
    if (merged.length > 0) merged[merged.length - 1] += ` ${buffer}`;
    else merged.push(buffer);
  }

  const final: string[] = [];
  for (const chunk of merged) {
    if (chunk.length <= MAX_CHUNK_CHARS) {
      final.push(chunk);
      continue;
    }
    const sentences = chunk.match(/[^.!?]+[.!?]+|\S+$/g) ?? [chunk];
    let sub = '';
    for (const sentence of sentences) {
      if (sub.length + sentence.length > MAX_CHUNK_CHARS && sub.length > 0) {
        final.push(sub.trim());
        sub = '';
      }
      sub += sentence;
    }
    if (sub.trim()) final.push(sub.trim());
  }
  return final;
}

export interface DiffChunk {
  text: string;
  status: 'unchanged' | 'modified' | 'new' | 'removed';
  similarity: number;
  matchedText: string | null;
}

export interface RiskFactorDiffSummary {
  unchanged: number;
  modified: number;
  added: number;
  removed: number;
}

export interface RiskFactorDiffResult {
  chunks: DiffChunk[];
  summary: RiskFactorDiffSummary;
}

/**
 * Diffs two risk-factor-section texts (already extracted via
 * `extractRiskFactorsSection`) at chunk (roughly paragraph) granularity.
 * Each chunk in the newer text is matched against its most semantically
 * similar chunk in the older text via cosine similarity on local sentence
 * embeddings:
 *   - similarity >= 0.92: functionally unchanged (paraphrase-level noise)
 *   - similarity >= 0.60: the same risk factor, materially reworded
 *   - below 0.60: no real match found - a genuinely new risk factor
 * Any older-text chunk that never comes out as the best match for a
 * newer-text chunk (at or above the 'modified' threshold) is reported as
 * removed - a risk factor the company no longer discloses.
 */
export async function diffRiskFactorTexts(oldText: string, newText: string): Promise<RiskFactorDiffResult> {
  const oldChunks = chunkRiskFactorText(oldText);
  const newChunks = chunkRiskFactorText(newText);

  const [oldVectors, newVectors] = await Promise.all([embedTexts(oldChunks), embedTexts(newChunks)]);

  const matchedOldIndexes = new Set<number>();
  const chunks: DiffChunk[] = [];

  for (let i = 0; i < newChunks.length; i++) {
    let bestScore = -1;
    let bestIndex = -1;
    for (let j = 0; j < oldChunks.length; j++) {
      const score = cosineSimilarity(newVectors[i]!, oldVectors[j]!);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = j;
      }
    }

    if (bestIndex !== -1 && bestScore >= UNCHANGED_THRESHOLD) {
      matchedOldIndexes.add(bestIndex);
      chunks.push({ text: newChunks[i]!, status: 'unchanged', similarity: bestScore, matchedText: oldChunks[bestIndex]! });
    } else if (bestIndex !== -1 && bestScore >= MODIFIED_THRESHOLD) {
      matchedOldIndexes.add(bestIndex);
      chunks.push({ text: newChunks[i]!, status: 'modified', similarity: bestScore, matchedText: oldChunks[bestIndex]! });
    } else {
      chunks.push({ text: newChunks[i]!, status: 'new', similarity: Math.max(bestScore, 0), matchedText: null });
    }
  }

  for (let j = 0; j < oldChunks.length; j++) {
    if (!matchedOldIndexes.has(j)) {
      chunks.push({ text: oldChunks[j]!, status: 'removed', similarity: 0, matchedText: null });
    }
  }

  const summary: RiskFactorDiffSummary = { unchanged: 0, modified: 0, added: 0, removed: 0 };
  for (const chunk of chunks) {
    if (chunk.status === 'unchanged') summary.unchanged++;
    else if (chunk.status === 'modified') summary.modified++;
    else if (chunk.status === 'new') summary.added++;
    else summary.removed++;
  }

  return { chunks, summary };
}

/** Convenience wrapper: extracts the Risk Factors section from each full 10-K text before diffing. */
export async function diffRiskFactorFilings(oldFullText: string, newFullText: string): Promise<RiskFactorDiffResult | null> {
  const oldSection = extractRiskFactorsSection(oldFullText);
  const newSection = extractRiskFactorsSection(newFullText);
  if (!oldSection || !newSection) return null;
  return diffRiskFactorTexts(oldSection, newSection);
}
