/**
 * Unit tests for extractRiskFactorsSection (src/riskFactors.ts) - Phase 6,
 * step 3. Pure string-in/string-out function; each fixture below targets a
 * specific, already-documented edge case from that function's own doc
 * comment (the table-of-contents disambiguation in particular is exactly
 * the real bug it was written to avoid, confirmed against a real Apple 10-K
 * before that code was written).
 */
import { extractRiskFactorsSection } from '../riskFactors';

describe('extractRiskFactorsSection', () => {
  test('skips the table-of-contents entry and extracts the real section (the last match)', () => {
    const fullText = [
      'TABLE OF CONTENTS',
      'Item 1A.',
      'Risk Factors',
      '5',
      'Item 1B.',
      'Unresolved Staff Comments',
      '12',
      '... (many pages of unrelated filing content) ...',
      'Item 1A.    Risk Factors',
      'The following summarizes factors that could materially affect our business.',
      'We face intense competition in every market we serve.',
      'Item 1B.    Unresolved Staff Comments',
      'None.',
    ].join('\n');

    const section = extractRiskFactorsSection(fullText);

    expect(section).not.toBeNull();
    expect(section).toContain('The following summarizes factors');
    expect(section).toContain('intense competition');
    // Must not include the TOC's bare page number, and must not run past
    // its own end boundary into the next item's heading/content.
    expect(section).not.toMatch(/^5$/m);
    expect(section).not.toContain('Unresolved Staff Comments');
    expect(section).not.toContain('None.');
  });

  test('ends at Item 2 when a filing omits Item 1B entirely', () => {
    const fullText = [
      'Item 1A.    Risk Factors',
      'Our results may fluctuate due to seasonality.',
      'Item 2.    Properties',
      'We lease office space in several countries.',
    ].join('\n');

    const section = extractRiskFactorsSection(fullText);

    expect(section).not.toBeNull();
    expect(section).toContain('fluctuate due to seasonality');
    expect(section).not.toContain('Properties');
    expect(section).not.toContain('lease office space');
  });

  test('returns null when no Item 1A heading is present at all (a Phase 2 extraction failure)', () => {
    const fullText = 'This is a filing with no recognizable risk-factors heading anywhere in it.';
    expect(extractRiskFactorsSection(fullText)).toBeNull();
  });

  test('returns null rather than an empty string when the heading is immediately followed by the next item', () => {
    const fullText = 'Item 1A.    Risk Factors\nItem 1B.    Unresolved Staff Comments\nNone.';
    expect(extractRiskFactorsSection(fullText)).toBeNull();
  });

  test('extracts real content even with irregular spacing/casing around the heading', () => {
    const fullText = 'item1a.   risk factors\nSupply chain concentration is a material risk.\nItem 2. Properties';
    const section = extractRiskFactorsSection(fullText);
    expect(section).toContain('Supply chain concentration');
  });
});
