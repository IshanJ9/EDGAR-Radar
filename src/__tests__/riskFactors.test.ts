/**
 * Unit tests for extractRiskFactorsSection (src/riskFactors.ts) - Phase 6,
 * step 3. Pure string-in/string-out function; each fixture below targets a
 * specific, already-documented edge case from that function's own doc
 * comment (the table-of-contents disambiguation in particular is exactly
 * the real bug it was written to avoid, confirmed against a real Apple 10-K
 * before that code was written).
 *
 * Post-Phase 7 hardening, step 3 (F1c-2): the fixtures from the line
 * "Real filings" down mirror what the 196-company universe's 377 stored
 * 10-Ks actually contain - see PROGRESS.md. A real section is at least
 * ~13,000 characters, so fixtures carry `risks()` padding to clear the
 * function's 1,000-character minimum.
 */
import { extractRiskFactorsSection } from '../riskFactors';

/** Realistic Risk Factors prose, comfortably over the 1,000-character minimum. */
function risks(topic = 'our business'): string {
  return Array.from({ length: 12 }, (_, i) => `Risk ${i + 1}: changes affecting ${topic} could adversely affect our results of operations and financial condition.`).join('\n');
}

describe('extractRiskFactorsSection', () => {
  test('skips the table-of-contents entry and extracts the real section', () => {
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
      risks(),
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
      risks(),
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
    const fullText = `item1a.   risk factors\nSupply chain concentration is a material risk.\n${risks()}\nItem 2. Properties`;
    const section = extractRiskFactorsSection(fullText);
    expect(section).toContain('Supply chain concentration');
  });

  // Real filings (F1c-2).

  test('a later cross-reference to Item 1A is not mistaken for the heading (Alphabet, Nvidia: 62 of 181 diffs)', () => {
    // The old rule took the LAST match; these cross-references sit after Item
    // 2, so the "section" ran from one of them to the signature page.
    const fullText = [
      'Item 1A.',
      'Risk Factors',
      '9',
      'Item 1B.',
      'Unresolved Staff Comments',
      '23',
      'ITEM 1A.RISK FACTORS',
      'Our operations and financial results are subject to various risks.',
      risks(),
      'ITEM 1B.UNRESOLVED STAFF COMMENTS',
      'Not applicable.',
      'ITEM 2.PROPERTIES',
      'Management discussion: for more information, see Part I, Item 1A Risk Factors and Legal Matters in Note 10.',
      'Revenues grew in every segment.',
      '/S/ K. RAM SHRIRAM Director',
    ].join('\n');

    const section = extractRiskFactorsSection(fullText);

    expect(section).toContain('Our operations and financial results');
    expect(section).not.toContain('Revenues grew');
    expect(section).not.toContain('SHRIRAM');
  });

  test('a cross-reference BEFORE the real section does not start it early (Alphabet, in Item 1 Business)', () => {
    const fullText = [
      'Item 1. Business',
      'Competition is intense. For more information about competition, see Item 1A Risk Factors of this Annual Report on Form 10-K.',
      risks('the business description'),
      'ITEM 1A.RISK FACTORS',
      'Our operations and financial results are subject to various risks.',
      risks(),
      'ITEM 1B.UNRESOLVED STAFF COMMENTS',
    ].join('\n');

    const section = extractRiskFactorsSection(fullText);

    expect(section).toMatch(/^Our operations and financial results/);
    expect(section).not.toContain('the business description');
  });

  test.each([
    ['a colon (Comcast, AMAT, Realty Income)', 'Item 1A: Risk Factors'],
    ['a hyphen (Global Payments)', 'ITEM 1A - RISK FACTORS'],
    ['an en dash', 'Item 1A – Risk Factors'],
    ['a vertical bar (AIG)', 'ITEM 1A | Risk Factors'],
  ])('accepts a heading written with %s', (_name, heading) => {
    const fullText = ['Item 1A', 'Risk Factors', '19', 'Item 1B', '27', heading, 'Our businesses operate in highly competitive markets.', risks(), 'Item 1B: Unresolved Staff Comments'].join('\n');

    const section = extractRiskFactorsSection(fullText);

    expect(section).toContain('highly competitive markets');
  });

  test('a heading repeated as a running page header does not cut the section short - the first heading wins', () => {
    // Each repeat starts a valid but truncated section; only the first holds all of it.
    const fullText = [
      'Item 1A. Risk Factors',
      'Our first page of risks starts here.',
      risks('page one'),
      'Item 1A. Risk Factors',
      risks('page two'),
      'Item 1B. Unresolved Staff Comments',
    ].join('\n');

    const section = extractRiskFactorsSection(fullText);

    expect(section).toContain('Our first page of risks starts here.');
    expect(section).toContain('page two');
  });

  test('ends at Item 1C (Cybersecurity) when Item 1B is absent', () => {
    const fullText = ['Item 1A. Risk Factors', 'Tariffs could raise our costs.', risks(), 'Item 1C. Cybersecurity', 'We maintain a security program.'].join('\n');

    const section = extractRiskFactorsSection(fullText);

    expect(section).toContain('Tariffs could raise our costs');
    expect(section).not.toContain('security program');
  });

  test('a heading with no following Item 1B, 1C or 2 is not a section - it never runs to the end of the filing', () => {
    const fullText = ['Item 1A. Risk Factors', risks(), 'Management discussion follows.', 'Signatures'].join('\n');

    expect(extractRiskFactorsSection(fullText)).toBeNull();
  });

  test('only a table-of-contents entry - an index-style 10-K like GE or Intel - is null, not a page number', () => {
    const fullText = ['Item 1.', 'Business', '4-7', 'Item 1A.', 'Risk Factors', '24-31', 'Item 1B.', 'Unresolved Staff Comments', 'Not applicable'].join('\n');

    expect(extractRiskFactorsSection(fullText)).toBeNull();
  });

  test('a section incorporated by reference to another document is null (BNY Mellon)', () => {
    const fullText = [
      'Item 1A. Risk Factors',
      'The information required by this Item is set forth in the Annual Report under "MD&A - Risk Factors," which portion is incorporated herein by reference.',
      'Item 1B. Unresolved Staff Comments',
    ].join('\n');

    expect(extractRiskFactorsSection(fullText)).toBeNull();
  });
});
