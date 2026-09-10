import * as cheerio from 'cheerio';
import { secFetch, padCik, FilingReference } from './sec';

export function buildFilingDocumentUrl(cik: string, filing: FilingReference): string {
  const cikNoLeadingZeros = String(Number(padCik(cik)));
  const accnNoDashes = filing.accessionNumber.replace(/-/g, '');
  return `https://www.sec.gov/Archives/edgar/data/${cikNoLeadingZeros}/${accnNoDashes}/${filing.primaryDocument}`;
}

export async function fetchFilingDocumentHtml(cik: string, filing: FilingReference): Promise<string> {
  const url = buildFilingDocumentUrl(cik, filing);
  const response = await secFetch(url);
  if (!response.ok) {
    throw new Error(`Request to ${url} failed with status ${response.status}.`);
  }
  return response.text();
}

/**
 * Strips a filing's HTML down to clean, searchable plaintext. Modern SEC
 * filings use Inline XBRL, which embeds a large block of machine-readable
 * tag data in a hidden <div style="display:none"><ix:header>...</ix:header>
 * (plus other scattered hidden elements) - naive `.text()` extraction
 * pulls all of that in as garbage. Block-level elements also get a newline
 * inserted so words from adjacent elements don't get jammed together
 * (e.g. "UNITED STATES" + "SECURITIES..." merging into
 * "UNITED STATESSECURITIES...", which would corrupt tsvector tokenization).
 */
export function extractPlainText(html: string): string {
  const $ = cheerio.load(html);

  $('script, style').remove();
  $('[style*="display:none"], [style*="display: none"]').remove();

  $('br').replaceWith('\n');
  $('p, div, tr, li, h1, h2, h3, h4, h5, h6, td, th').each((_, el) => {
    $(el).append('\n');
  });

  return $('body')
    .text()
    .replace(/[ \t]+/g, ' ')
    .replace(/\n+/g, '\n')
    .replace(/ *\n */g, '\n')
    .trim();
}
