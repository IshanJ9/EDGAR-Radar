/**
 * Extracts the "Item 1A. Risk Factors" section from a 10-K's full plaintext
 * (as already extracted/stored by src/filingText.ts). Confirmed against
 * real Apple 10-K text before writing this: a naive first-match search
 * finds the *table of contents* entry ("Item 1A.\nRisk Factors\n5\nItem
 * 1B...."), not the real section - the real heading is immediately
 * followed by substantive prose ("Item 1A.    Risk Factors\nThe following
 * summarizes factors..."), while the TOC entry is immediately followed by
 * a bare page number. The real heading is also the *last* match of this
 * pattern in the document (earlier ones are the TOC and/or "as discussed
 * in Item 1A... under the heading 'Risk Factors'" cross-references, which
 * don't match since they have extra words between "Item 1A" and "Risk
 * Factors" that this pattern's tight whitespace-only gap excludes).
 */
export function extractRiskFactorsSection(fullText: string): string | null {
  const startPattern = /item\s*1a\.?\s*risk factors/gi;
  const startMatches = [...fullText.matchAll(startPattern)];
  if (startMatches.length === 0) return null;

  const startMatch = startMatches[startMatches.length - 1]!;
  const start = startMatch.index! + startMatch[0].length;

  const afterStart = fullText.slice(start);
  // Item 1B (Unresolved Staff Comments) usually follows directly; some
  // companies omit it and go straight to Item 2 (Properties) - whichever
  // comes first after the start is the real end boundary.
  const endPattern = /item\s*1b\.?|item\s*2\.?\s/i;
  const endMatch = afterStart.match(endPattern);
  const end = endMatch ? start + endMatch.index! : fullText.length;

  const section = fullText.slice(start, end).trim();
  return section.length > 0 ? section : null;
}
