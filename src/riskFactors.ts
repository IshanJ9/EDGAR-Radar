/**
 * Extracts the "Item 1A. Risk Factors" section from a 10-K's full plaintext
 * (as already extracted/stored by src/filingText.ts).
 *
 * Phase 5 confirmed against real Apple 10-K text that "Item 1A. Risk
 * Factors" appears more than once: in the table of contents (followed by a
 * bare page number) and in cross-references, besides the real heading. It
 * took the LAST match. Post-Phase 7 hardening, step 3 (F1c-2) ran it over
 * all 377 stored 10-Ks of the 196-company universe and found that rule wrong
 * for most of them:
 * - 122 "sections" ran to the end of the filing: the last match was a
 *   cross-reference after Item 2 ("see Part I, Item 1A Risk Factors and
 *   Legal Matters in Note 10"), with no end heading after it - so 62 of 181
 *   stored diffs compared MD&A and the financial statements.
 * - 30 were a few characters - a table-of-contents page number - and 13 were
 *   missing, often because the heading used a separator the pattern did not
 *   allow ("Item 1A: Risk Factors", "ITEM 1A - RISK FACTORS",
 *   "ITEM 1A | Risk Factors").
 *
 * So now:
 * - A heading must START A LINE; cross-references sit mid-sentence. Any of
 *   . : - – — | may separate "Item 1A" from "Risk Factors".
 * - Its section ends at the next line-starting Item 1B, 1C or 2 heading. A
 *   heading with no such end is rejected, so a section can never again run
 *   to the end of the filing.
 * - A section under MIN_SECTION_LENGTH is rejected: a table-of-contents
 *   entry, or a note that the section is incorporated by reference from
 *   another document. Real sections are at least ~13,000 characters (5% of
 *   the filing); everything rejected this way was under ~200.
 * - The first heading that qualifies wins. (Of the stored 10-Ks, 9 have more
 *   than one - the heading repeated as a running page header - and in all 9
 *   the first is also the longest, so nothing more is needed.)
 *
 * Returns null when nothing qualifies - including 10-Ks laid out as an index
 * ("Item 1A. Risk Factors ... Pages 37-51", e.g. GE and Intel), whose section
 * is headed just "Risk Factors". On the stored 10-Ks this extracts 363 of
 * 377 (212 before); 7 companies return null for both their 10-Ks.
 */
// [ \t\xa0] rather than \s: a heading's words may be split by spaces, tabs
// or non-breaking spaces, but only the explicit \n may cross a line.
const HEADING = /(?:^|\n)[ \t\xa0]*item[ \t\xa0]*1a[ \t\xa0]*[.:|\-–—]?[ \t\xa0]*\n?[ \t\xa0]*risk factors/gi;
const END = /\n[ \t\xa0]*item[ \t\xa0]*(?:1b|1c|2)\b/i;
const MIN_SECTION_LENGTH = 1000;

export function extractRiskFactorsSection(fullText: string): string | null {
  for (const heading of fullText.matchAll(HEADING)) {
    const rest = fullText.slice(heading.index! + heading[0].length);
    const end = rest.match(END);
    if (!end) continue;
    const section = rest.slice(0, end.index).trim();
    if (section.length >= MIN_SECTION_LENGTH) return section;
  }
  return null;
}
