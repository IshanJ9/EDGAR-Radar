import Redis from 'ioredis';
import { optionalEnv } from './config';
import { createLogger } from './logger';
import { padCik } from './sec';

/**
 * Response cache for the hot read endpoints - Phase 7, step 3.
 *
 * Cache-aside: a route looks up the finished JSON body, and on a miss
 * computes it and stores it. Every write to the tables those bodies come
 * from deletes the affected keys (see the repositories), and a TTL bounds
 * how stale anything can get if a deletion is missed.
 *
 * Runs on its own Redis (`redis-cache` in docker-compose.yml), not the queue
 * Redis: a cache must be allowed to evict under memory pressure
 * (allkeys-lru), while BullMQ requires the queue Redis to be `noeviction` so
 * it can never silently drop a job. One server cannot hold both policies.
 *
 * It fails open. The cache is an optimisation, so an unreachable or slow
 * cache Redis turns into a miss, never an error and never a delay - the
 * lesson of the read replica, where an unreachable dependency first made
 * every request take ~3.4s (see PROGRESS.md, Phase 7 step 2).
 */

const logger = createLogger('cache');

/**
 * Backstop only - freshness normally comes from invalidation. It bounds the
 * cases invalidation cannot cover: a writer running without the cache
 * configured (the host-run scripts - backfill, poller, reconciliation), and a
 * deletion that failed because the cache was briefly unreachable.
 */
export const CACHE_TTL_SECONDS = 300;

/**
 * Why a key is deleted twice. A read that started before a write can finish
 * after it and store the old value, undoing the first deletion - a classic
 * cache-aside race, and a wider one here because reads come from an
 * asynchronous replica that can briefly lag the primary (measured at 1.5 ms
 * in step 2). Deleting again a moment later removes anything stored in that
 * window. Any lag beyond this is bounded by the TTL instead.
 */
export const INVALIDATION_REPEAT_MS = 2000;

/** Versioned so a change to a body's shape can abandon every old entry at once. */
export const cacheKeys = {
  // Padded, because routes accept `320193` and `0000320193` for the same
  // company while writers always use the padded form - unpadded keys would
  // be two entries, and invalidation would only ever clear one of them.
  company: (cik: string) => `v1:company:${padCik(cik)}`,
  facts: (cik: string) => `v1:facts:${padCik(cik)}`,
  riskFactorDiff: (cik: string) => `v1:risk-factor-diff:${padCik(cik)}`,
  // Post-Phase 7 hardening, step 3. A fact write clears that company's scores
  // (upsertFact). The company list, the stats and the filings feed are never
  // invalidated - the list because fact writes are constant on a busy day and
  // it is expensive to rebuild - so the TTL bounds how stale they get.
  scores: (cik: string) => `v1:scores:${padCik(cik)}`,
  // F3: the company page's charts - cleared with the scores on a fact write.
  financials: (cik: string) => `v1:financials:${padCik(cik)}`,
  companyList: 'v1:company-list',
  stats: 'v1:stats',
  recentFilings: (hours: number, exclude: string[]) => `v1:recent-filings:${hours}:${exclude.join(',')}`,
};

/** The three commands the cache needs; an ioredis client satisfies it. */
export interface CacheClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
}

export interface ResponseCache {
  /** The stored body, or null on a miss - including when the cache is unavailable. */
  get(key: string): Promise<string | null>;
  /** Stores a body. Never throws. */
  set(key: string, body: string): Promise<void>;
  /** Deletes keys now and again after INVALIDATION_REPEAT_MS. Never throws. */
  invalidate(...keys: string[]): Promise<void>;
}

interface WarnLogger {
  warn(obj: object, msg: string): void;
}

export interface ResponseCacheOptions {
  ttlSeconds?: number;
  repeatAfterMs?: number;
  /** How the second deletion is scheduled; injectable for tests. */
  schedule?: (fn: () => void, ms: number) => void;
  /** Minimum gap between failure warnings, so an outage logs once, not per request. */
  warnEveryMs?: number;
  now?: () => number;
}

function scheduleUnref(fn: () => void, ms: number): void {
  // unref: a pending second deletion must never keep a process alive.
  setTimeout(fn, ms).unref();
}

/**
 * Exported as a factory so the behaviour can be unit-tested with a fake
 * client. With no client, every operation is a no-op and every read a miss.
 */
export function createResponseCache(client: CacheClient | null, log: WarnLogger, options: ResponseCacheOptions = {}): ResponseCache {
  const {
    ttlSeconds = CACHE_TTL_SECONDS,
    repeatAfterMs = INVALIDATION_REPEAT_MS,
    schedule = scheduleUnref,
    warnEveryMs = 30_000,
    now = Date.now,
  } = options;

  let lastWarnAt = -Infinity;
  function warn(err: unknown, operation: string): void {
    if (now() - lastWarnAt < warnEveryMs) return;
    lastWarnAt = now();
    log.warn({ err, operation }, 'Response cache unavailable; serving without it (further warnings suppressed for a while)');
  }

  if (!client) {
    return {
      get: async () => null,
      set: async () => undefined,
      invalidate: async () => undefined,
    };
  }

  async function del(keys: string[]): Promise<void> {
    try {
      await client!.del(...keys);
    } catch (err) {
      warn(err, 'del');
    }
  }

  return {
    async get(key) {
      try {
        return await client.get(key);
      } catch (err) {
        warn(err, 'get');
        return null;
      }
    },
    async set(key, body) {
      try {
        await client.set(key, body, 'EX', ttlSeconds);
      } catch (err) {
        warn(err, 'set');
      }
    },
    async invalidate(...keys) {
      if (keys.length === 0) return;
      await del(keys);
      schedule(() => void del(keys), repeatAfterMs);
    },
  };
}

let active: ResponseCache = createResponseCache(null, logger);

/**
 * Connects the cache, if CACHE_REDIS_URL is set. Called explicitly by the two
 * long-running services that use it - the API (src/server.ts) and the parser
 * worker (scripts/parserWorker.ts) - rather than at import time. The
 * repositories import this module, so the host scripts do too, and an open
 * Redis connection would stop a finished `npm run backfill` from exiting;
 * ioredis has no way to unreference its socket. Without this call the cache
 * stays a no-op, and the TTL bounds anything those scripts change.
 */
export function initResponseCache(): void {
  const url = optionalEnv('CACHE_REDIS_URL');
  if (!url) return;
  const client = new Redis(url, {
    // Fail fast instead of queueing: while disconnected, a command errors
    // immediately (-> a miss) rather than waiting for a reconnect.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    // A hung cache must not stall a request; a same-host reply takes well
    // under a millisecond.
    commandTimeout: 250,
    connectTimeout: 2000,
  });
  // ioredis emits 'error' on every failed reconnect attempt, and prints
  // "[ioredis] Unhandled error event" for each one if nothing listens. Logged
  // at debug only: the user-visible signal is the throttled warning from the
  // commands that fail (createResponseCache), and a cache outage with no
  // traffic affects nobody.
  client.on('error', (err) => logger.debug({ err }, 'Cache Redis connection error'));
  active = createResponseCache(client, logger);
}

/** Delegates to whichever cache is active, so importers never hold a stale reference. */
export const responseCache: ResponseCache = {
  get: (key) => active.get(key),
  set: (key, body) => active.set(key, body),
  invalidate: (...keys) => active.invalidate(...keys),
};
