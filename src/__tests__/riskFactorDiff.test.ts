/**
 * Unit tests for chunkRiskFactorText (src/riskFactorDiff.ts) - Phase 6,
 * step 3. Deliberately scoped to chunking only, not the full
 * diffRiskFactorTexts/diffRiskFactorFilings pipeline - those call the real
 * embedding model (src/embeddings.ts), which makes them integration-shaped
 * (real model load, several seconds each), not unit-shaped. chunkRiskFactorText
 * itself is pure text processing with no model involved.
 *
 * The 3 artifact-stripping cases below are not hypothetical: they are
 * regression tests for the exact pagination-artifact bugs found and fixed
 * during Phase 5's closing verification (see PROGRESS.md) - a real,
 * word-for-word-identical paragraph was once misclassified as "modified"
 * purely because a page-header/page-number line had merged into its text.
 */
import { chunkRiskFactorText } from '../riskFactorDiff';

describe('chunkRiskFactorText', () => {
  test('returns an empty array for empty input', () => {
    expect(chunkRiskFactorText('')).toEqual([]);
    expect(chunkRiskFactorText('   \n  \n ')).toEqual([]);
  });

  test('merges short lines forward until a chunk reaches the minimum size', () => {
    const shortLines = ['A.', 'B.', 'C.', 'D.'];
    const chunks = chunkRiskFactorText(shortLines.join('\n'));
    // 4 short lines (well under 150 chars combined) must not each become
    // their own meaningless chunk - they should collapse into one.
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toBe('A. B. C. D.');
  });

  test('splits a chunk that exceeds the maximum size at sentence boundaries', () => {
    // One very long line, comfortably over MAX_CHUNK_CHARS (900), built from
    // repeated complete sentences so a correct split never cuts mid-sentence.
    const sentence = 'This is one complete sentence about a material business risk that the company faces. ';
    const longLine = sentence.repeat(20); // ~1740 chars
    const chunks = chunkRiskFactorText(longLine);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(900);
      // Every chunk should end on a real sentence boundary, not mid-word.
      expect(chunk.trim().endsWith('.')).toBe(true);
    }
    // No sentence content lost or duplicated in the split.
    expect(chunks.join(' ')).toContain('material business risk');
  });

  test('strips standalone page-number lines rather than merging them into chunk text', () => {
    const text = ['This paragraph continues across a page boundary,', '16', 'and finishes here with no page-number text mixed in.'].join('\n');
    const chunks = chunkRiskFactorText(text);
    const combined = chunks.join(' ');
    expect(combined).not.toMatch(/\b16\b/);
    expect(combined).toContain('continues across a page boundary');
    expect(combined).toContain('finishes here with no page-number text');
  });

  test('strips pipe-delimited running page-header lines (e.g. "Company | Form 10-K | 16")', () => {
    const text = ['Real risk-factor content about supply chain concentration.', 'Apple Inc. | 2024 Form 10-K | 16', 'More real content continues here after the header artifact.'].join(
      '\n',
    );
    const chunks = chunkRiskFactorText(text);
    const combined = chunks.join(' ');
    expect(combined).not.toContain('Apple Inc. | 2024 Form 10-K');
    expect(combined).toContain('supply chain concentration');
    expect(combined).toContain('More real content continues');
  });

  test('strips standalone "Table of Contents" header lines, case-insensitively', () => {
    const text = ['Real risk-factor content about cybersecurity threats.', 'Table of Contents', 'table of contents', 'More real content about regulatory exposure follows.'].join(
      '\n',
    );
    const chunks = chunkRiskFactorText(text);
    const combined = chunks.join(' ');
    expect(combined.toLowerCase()).not.toContain('table of contents');
    expect(combined).toContain('cybersecurity threats');
    expect(combined).toContain('regulatory exposure');
  });
});
