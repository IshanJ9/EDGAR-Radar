import { pool } from '../db';
import { padCik, fetchSubmissions, findMostRecentFiling, findRecentFilings, FilingReference } from '../sec';
import { fetchFilingDocumentHtml, extractPlainText } from '../filingText';

export class NoFilingFoundError extends Error {}

async function upsertFilingTextSection(
  cik: string,
  accn: string,
  form: string,
  filingDate: string,
  sectionName: string,
  content: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO filing_text_sections (cik, accn, form, filing_date, section_name, content)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (cik, accn, section_name)
     DO UPDATE SET content = EXCLUDED.content, form = EXCLUDED.form, filing_date = EXCLUDED.filing_date`,
    [cik, accn, form, filingDate, sectionName, content],
  );
}

/**
 * Fetches a specific, already-known filing's document, extracts its
 * plaintext, and stores it. Used when the caller (e.g. the Parser Worker,
 * acting on a `filing.discovered` job) already knows exactly which filing
 * to ingest, so it doesn't need to re-fetch the submissions list to find it.
 */
export async function ingestFilingText(
  cik: string,
  filing: FilingReference,
): Promise<{ cik: string; accn: string; form: string; filingDate: string; contentLength: number }> {
  const paddedCik = padCik(cik);
  const html = await fetchFilingDocumentHtml(paddedCik, filing);
  const content = extractPlainText(html);

  await upsertFilingTextSection(paddedCik, filing.accessionNumber, filing.form, filing.filingDate, 'full_document', content);

  return {
    cik: paddedCik,
    accn: filing.accessionNumber,
    form: filing.form,
    filingDate: filing.filingDate,
    contentLength: content.length,
  };
}

/**
 * Fetches a company's most recent filing of one of `formTypes` (e.g. 10-K)
 * and ingests it via `ingestFilingText`. Used by the backfill script, which
 * (unlike the Parser Worker) doesn't already have a specific filing in hand.
 */
export async function ingestMostRecentFilingText(
  cik: string,
  formTypes: string[] = ['10-K'],
): Promise<{ cik: string; accn: string; form: string; filingDate: string; contentLength: number }> {
  const paddedCik = padCik(cik);
  const submissions = await fetchSubmissions(paddedCik);
  const filing = findMostRecentFiling(submissions, formTypes);
  if (!filing) {
    throw new NoFilingFoundError(`No filing of type [${formTypes.join(', ')}] found for CIK ${paddedCik}.`);
  }

  return ingestFilingText(paddedCik, filing);
}

/**
 * Fetches and ingests a company's `count` most recent filings of one of
 * `formTypes` - used for risk-factor-section diffing (Phase 5), which needs
 * a company's two most recent 10-Ks, not just the latest one the poller
 * already keeps fresh. Always re-fetches and re-extracts each filing (the
 * underlying `filing_text_sections` upsert is idempotent, so this is safe
 * to call repeatedly) - it does not skip filings already stored. Found
 * during Phase 5's closing failure-case testing that an earlier version of
 * this comment incorrectly claimed it did skip them; corrected here rather
 * than left misleading. A practical effect of always re-fetching: any
 * previously-corrupted or stale stored text for these two filings
 * self-heals on the next call, since it gets overwritten with a fresh copy
 * from SEC before being read back.
 */
export async function ingestRecentFilingsText(
  cik: string,
  formTypes: string[] = ['10-K'],
  count = 2,
): Promise<Array<{ cik: string; accn: string; form: string; filingDate: string; contentLength: number }>> {
  const paddedCik = padCik(cik);
  const submissions = await fetchSubmissions(paddedCik);
  const filings = findRecentFilings(submissions, formTypes, count);
  if (filings.length === 0) {
    throw new NoFilingFoundError(`No filing of type [${formTypes.join(', ')}] found for CIK ${paddedCik}.`);
  }

  const results = [];
  for (const filing of filings) {
    results.push(await ingestFilingText(paddedCik, filing));
  }
  return results;
}

export interface StoredFilingText {
  accn: string;
  filingDate: string;
  content: string;
}

/** Reads back up to `count` most recently stored filings of a form type (newest first), full text included. */
export async function getRecentFilingTexts(cik: string, formTypes: string[] = ['10-K'], count = 2): Promise<StoredFilingText[]> {
  const result = await pool.query(
    `SELECT accn, filing_date, content FROM filing_text_sections
     WHERE cik = $1 AND form = ANY($2) AND section_name = 'full_document'
     ORDER BY filing_date DESC
     LIMIT $3`,
    [padCik(cik), formTypes, count],
  );
  return result.rows.map((row) => ({ accn: row.accn, filingDate: row.filing_date, content: row.content }));
}

export interface FilingTextSearchResult {
  cik: string;
  accn: string;
  form: string;
  filingDate: string;
  headline: string;
}

/** Full-text search across all ingested filing sections, ranked by relevance. */
export async function searchFilingText(query: string, limit = 10): Promise<FilingTextSearchResult[]> {
  const result = await pool.query(
    `SELECT cik, accn, form, filing_date,
            ts_headline('english', content, websearch_to_tsquery('english', $1), 'MaxFragments=1, MaxWords=30') AS headline
     FROM filing_text_sections
     WHERE content_tsv @@ websearch_to_tsquery('english', $1)
     ORDER BY ts_rank(content_tsv, websearch_to_tsquery('english', $1)) DESC
     LIMIT $2`,
    [query, limit],
  );
  return result.rows.map((row) => ({
    cik: row.cik,
    accn: row.accn,
    form: row.form,
    filingDate: row.filing_date,
    headline: row.headline,
  }));
}
