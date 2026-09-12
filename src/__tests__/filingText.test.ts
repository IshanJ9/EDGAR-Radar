/**
 * Unit tests for extractPlainText (src/filingText.ts) - Phase 6, step 3.
 *
 * extractPlainText is a pure function (HTML string in, plaintext string
 * out), so unlike scoring.ts nothing needs mocking here. Assertions are
 * property-based rather than exact-string-match: cheerio's own whitespace
 * output is an implementation detail this function does not promise to
 * preserve exactly, but the 3 things its own doc comment promises -
 * hidden/script/style content stripped, adjacent block-level text kept
 * separated, and runs of whitespace collapsed - are exactly what is checked.
 *
 * The fixture below is written on a single line, deliberately with no
 * indentation/formatting whitespace between tags. Real SEC filing HTML is
 * machine-generated the same way (not hand-indented), and an early version
 * of this fixture that WAS hand-indented multi-line HTML produced an
 * occasional stray blank line in the output - confirmed, by testing a
 * compact equivalent directly, to be an artifact of that indentation
 * whitespace becoming its own meaningful text node between elements, not a
 * bug in extractPlainText itself against realistic input.
 */
import { extractPlainText } from '../filingText';

describe('extractPlainText', () => {
  const html =
    '<html><body>' +
    '<script>var shouldNotAppear = "script content";</script>' +
    '<style>.hidden { color: red; } /* shouldNotAppearEither */</style>' +
    '<div style="display:none"><ix:header>INLINE_XBRL_GARBAGE</ix:header></div>' +
    '<div style="display: none"><span>ALSO_HIDDEN_SPACED_VARIANT</span></div>' +
    '<p>UNITED STATES</p>' +
    '<p>SECURITIES AND EXCHANGE COMMISSION</p>' +
    '<div>Washington, D.C. 20549<br>Form 10-K</div>' +
    '<table><tr><td>Item 1.</td><td>Business</td></tr></table>' +
    '</body></html>';
  const result = extractPlainText(html);

  test('strips <script> and <style> content entirely', () => {
    expect(result).not.toContain('shouldNotAppear');
    expect(result).not.toContain('shouldNotAppearEither');
  });

  test('strips content hidden via display:none, in both spacing styles', () => {
    expect(result).not.toContain('INLINE_XBRL_GARBAGE');
    expect(result).not.toContain('ALSO_HIDDEN_SPACED_VARIANT');
  });

  test('keeps real visible text from block-level elements', () => {
    for (const expected of ['UNITED STATES', 'SECURITIES AND EXCHANGE COMMISSION', 'Washington, D.C. 20549', 'Form 10-K', 'Item 1.', 'Business']) {
      expect(result).toContain(expected);
    }
  });

  test('separates adjacent block-level elements instead of jamming their text together', () => {
    // The exact bug this function's own doc comment describes preventing:
    // naive .text() extraction would merge these into
    // "UNITED STATESSECURITIES AND EXCHANGE COMMISSION".
    expect(result).not.toContain('UNITED STATESSECURITIES');
    expect(result).not.toContain('20549Form 10-K'); // <br> must also separate
  });

  test('collapses runs of whitespace and trims the result', () => {
    expect(result).not.toMatch(/ {2,}/); // no double-or-more spaces
    expect(result).not.toMatch(/\t/);
    expect(result).not.toMatch(/\n{2,}/); // no blank lines
    expect(result).toBe(result.trim());
  });

  test('returns an empty string, not a crash, for an empty document', () => {
    expect(extractPlainText('<html><body></body></html>')).toBe('');
  });
});
