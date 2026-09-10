import { pool } from '../db';
import { padCik, fetchSubmissions, findMostRecentFiling } from '../sec';
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
 * Fetches a company's most recent filing of one of `formTypes` (e.g. 10-K),
 * extracts its plaintext, and stores it. Returns metadata about what was
 * ingested, not the (potentially very large) content itself.
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
