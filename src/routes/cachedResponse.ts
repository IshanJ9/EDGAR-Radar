import { Response } from 'express';
import { responseCache } from '../cache';

/**
 * Cache-aside for a JSON route - Phase 7, step 3 (see src/cache.ts).
 *
 * Two halves rather than one wrapper, because each route keeps its own
 * validation, error handling and 404s between them - and only a successful
 * body is ever cached. Errors and "not found" answers are not, so a company
 * that SEC starts reporting later is never hidden behind a cached 404.
 *
 * `X-Cache: HIT | MISS` says which path served a response, for debugging and
 * for step 4's load test to confirm what it measured.
 */

/** Sends the cached body and returns true on a hit; returns false on a miss, having sent nothing. */
export async function sendIfCached(res: Response, key: string): Promise<boolean> {
  const cached = await responseCache.get(key);
  if (cached === null) return false;
  res.set('X-Cache', 'HIT').type('application/json').send(cached);
  return true;
}

/**
 * Sends `body` as JSON and stores it under `key`. Serialised once and sent as
 * that exact string, so a later hit returns byte-for-byte what this miss did.
 * The store is not awaited: a slow cache must not delay the response.
 */
export function sendAndCache(res: Response, key: string, body: unknown): void {
  const json = JSON.stringify(body);
  res.set('X-Cache', 'MISS').type('application/json').send(json);
  // `null` is not a real answer (see getOrFetchCompany) - send it, never store it.
  if (body !== null && body !== undefined) {
    void responseCache.set(key, json);
  }
}
