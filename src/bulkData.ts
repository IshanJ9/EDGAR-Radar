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
  const nodeStream = Readable.fromWeb(response.body as any);
  await pipeline(nodeStream, createWriteStream(destPath));
}

/**
 * Reads only the specific CIKs' entries out of a local copy of the bulk zip,
 * using unzipper's random-access mode (reads the central directory, then
 * seeks directly to each requested entry) - never extracts or reads the
 * other ~10,000+ companies not in our universe.
 */
export async function extractCompanyFactsForCiks(zipPath: string, ciks: string[]): Promise<Map<string, any>> {
  if (!existsSync(zipPath)) {
    throw new Error(`Bulk companyfacts.zip not found at ${zipPath}`);
  }

  const directory = await unzipper.Open.file(zipPath);
  const wanted = new Set(ciks.map(padCik));
  const results = new Map<string, any>();

  for (const entry of directory.files) {
    const match = entry.path.match(/^CIK(\d{10})\.json$/);
    if (!match) continue;
    const cik = match[1]!;
    if (!wanted.has(cik)) continue;

    const buffer = await entry.buffer();
    results.set(cik, JSON.parse(buffer.toString('utf-8')));
  }

  return results;
}
