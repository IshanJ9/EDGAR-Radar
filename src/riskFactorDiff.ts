import { extractRiskFactorsSection } from './riskFactors';
import { embedTexts, cosineSimilarity } from './embeddings';

// Merge short fragments (a bolded lead-in sentence, a stray heading, a
// page-footer artifact from plaintext extraction) forward into the next
// substantive chunk, rather than embedding/diffing them as their own
// meaningless unit.
const MIN_CHUNK_CHARS = 150;
// The embedding model truncates around 256 tokens (~1000-1200 characters
// of English prose) - split anything longer at sentence boundaries so
// nothing silently gets cut off mid-thought before being embedded.
const MAX_CHUNK_CHARS = 900;

const UNCHANGED_THRESHOLD = 0.92;
const MODIFIED_THRESHOLD = 0.6;

export function chunkRiskFactorText(text: string): string[] {
  const lines = text
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

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
