import { createWriteStream, existsSync } from 'fs';
import { pipeline } from 'stream/promises';
import * as unzipper from 'unzipper';
import { secFetch, padCik } from './sec';

const BULK_COMPANYFACTS_URL = 'https://www.sec.gov/Archives/edgar/daily-index/xbrl/companyfacts.zip';

/** Streams SEC's full nightly companyfacts.zip (~1.4GB) to disk - never buffered fully in memory. */
export async function downloadBulkCompanyFacts(destPath: string): Promise<void> {
  const response = await secFetch(BULK_COMPANYFACTS_URL);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download bulk companyfacts.zip: status ${response.status}`);
  }

  const { Readable } = await import('stream');
  // Bridges the Fetch API's ReadableStream type to Node's `stream/web` one -
  // structurally compatible at runtime, but nominally different types from
  // different lib declarations, which is what actually needed the cast.
  // Derived from fromWeb's own parameter type rather than a hardcoded
  // import, so this can't drift out of sync with a future Node types update.
  const nodeStream = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
  await pipeline(nodeStream, createWriteStream(destPath));
}

/**
 * Reads only the specific CIKs' entries out of a local copy of the bulk zip,
 * using unzipper's random-access mode (reads the central directory, then
 * seeks directly to each requested entry) - never extracts or reads the
 * other ~10,000+ companies not in our universe.
 *
 * Processes one company at a time via `onCompany`, awaiting it before
 * moving to the next entry, rather than parsing and holding every
 * requested company's full companyfacts JSON in memory simultaneously.
 * Some companies' JSON is several MB once parsed into objects - buffering
 * all ~196 at once (the original design) was enough to crash a
 * memory-constrained host (confirmed: 892MB RAM + swap, real OOM abort
 * during JSON.parse). Processing incrementally keeps peak memory to
 * roughly one company's worth, regardless of how large the universe grows.
 */
export async function forEachCompanyFacts(
  zipPath: string,
  ciks: string[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- same untyped SEC companyfacts JSON shape as fetchCompanyFacts/mostRecentFact/annualFacts in sec.ts.
  onCompany: (cik: string, companyFacts: any) => Promise<void>,
): Promise<{ found: number; missing: string[] }> {
  if (!existsSync(zipPath)) {
    throw new Error(`Bulk companyfacts.zip not found at ${zipPath}`);
  }

  const directory = await unzipper.Open.file(zipPath);
  const wanted = new Set(ciks.map(padCik));
  const found = new Set<string>();

  for (const entry of directory.files) {
    const match = entry.path.match(/^CIK(\d{10})\.json$/);
    if (!match) continue;
    const cik = match[1]!;
    if (!wanted.has(cik)) continue;

    const buffer = await entry.buffer();
    const companyFacts = JSON.parse(buffer.toString('utf-8'));
    found.add(cik);
    await onCompany(cik, companyFacts);
    // Let the parsed object be garbage collected before the next entry -
    // nothing here retains a reference to it once onCompany returns.
  }

  const missing = ciks.map(padCik).filter((cik) => !found.has(cik));
  return { found: found.size, missing };
}
