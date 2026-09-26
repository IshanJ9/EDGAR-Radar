import { Pool, QueryResult, QueryResultRow, types } from 'pg';
import { optionalEnv, requireEnv } from './config';
import { createLogger } from './logger';

const logger = createLogger('db');

// pg's default DATE parser converts 'YYYY-MM-DD' into a JS Date at local
// midnight, then callers that read it back via toISOString() (or any code,
// like reconciliation's comparisons, that treats it as a string) see it
// shifted by the local timezone offset - e.g. '2026-06-27' round-trips as
// '2026-06-26T18:30:00.000Z' in UTC+5:30. Returning the raw string instead
// avoids the whole class of bug: DATE columns have no time/timezone
// component in Postgres, so there's nothing a JS Date usefully adds.
types.setTypeParser(types.builtins.DATE, (value) => value);

// requireEnv rather than passing process.env.DATABASE_URL straight through:
// with an undefined connection string, `pg` silently falls back to localhost
// and only connects on the first query, so a missing DATABASE_URL produced a
// service that started and logged exactly like a healthy one. See
// src/config.ts.
export const pool = new Pool({ connectionString: requireEnv('DATABASE_URL') });

// A Postgres restart sends FATAL 57P01 ("terminating connection due to
// administrator command") to every connected client. For a client sitting
// idle in the pool, `pg` emits that as an 'error' event on the pool itself -
// and an emitted 'error' with no listener is an uncaught exception, so the
// whole process exits. That is exactly how the Phase 3 poller died during its
// 48h run on 2026-09-12, when an Ubuntu unattended-upgrade of libc6 restarted
// Postgres; nothing restarted the poller, and it stayed dead for 3.5 days (see
// PROGRESS.md).
//
// By the time this fires, the pool has already terminated and removed the
// broken client, so logging is all that is needed: the next query opens a
// fresh connection once Postgres is back. Errors on an in-flight query are a
// separate path and unaffected - they still reject that query's promise for
// the caller to handle.
pool.on('error', (err) => {
  logger.error({ err }, 'Idle Postgres client errored and was removed from the pool (e.g. a server restart); continuing');
});

/**
 * What a repository read needs from a database handle. `pool` satisfies it,
 * and so does `readDb` below, so read functions take either one - which
 * server answers is the caller's decision, made where the consistency
 * trade-off is visible (see src/routes/companies.ts).
 */
export interface Queryable {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the same default as pg's own Pool.query, so passing `pool` or `readDb` into a repository types its rows exactly as calling pool.query directly always has.
  query<R extends QueryResultRow = any>(text: string, values?: unknown[]): Promise<QueryResult<R>>;
}

interface WarnLogger {
  warn(obj: object, msg: string): void;
}

export interface ReadDbOptions {
  /** How long to send reads straight to the primary after a replica failure. */
  cooldownMs?: number;
  /** Injectable clock, for tests. */
  now?: () => number;
}

/**
 * Read replica routing - Phase 7, step 2.
 *
 * Replica first; on any error, the same query again on the primary. Reads
 * are safe to repeat, so a replica that is down, restarting or still cloning
 * costs one failed attempt rather than a failed request. A query that is
 * itself broken fails on both, so it runs twice before erroring - an accepted
 * cost for keeping the rule this simple.
 *
 * After a failure, reads skip the replica for `cooldownMs` (a circuit
 * breaker), then the next read tries it again. Without this, every read paid
 * for the dead replica: with its container stopped, each request took ~3.4s
 * instead of milliseconds, because Docker's DNS takes ~2.5s to report that
 * `postgres-replica` no longer resolves - measured, and it happens before
 * connectionTimeoutMillis can help. With the breaker, an outage costs one
 * slow read per cooldown and one warning, instead of one of each per query.
 * Any error trips it, including a genuine query error, which only means the
 * primary briefly takes all the reads.
 *
 * With no replica configured this returns the primary unchanged, which is
 * what host-based `npm run dev`, the workers and every test get.
 *
 * Exported as a factory so the fallback can be unit-tested with fake
 * databases and a fake clock instead of real servers.
 */
export function createReadDb(
  primary: Queryable,
  replica: Queryable | null,
  log: WarnLogger,
  { cooldownMs = 30_000, now = Date.now }: ReadDbOptions = {},
): Queryable {
  if (!replica) {
    return primary;
  }
  let replicaSkippedUntil = 0;
  return {
    async query<R extends QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<R>> {
      if (now() < replicaSkippedUntil) {
        return primary.query<R>(text, values);
      }
      try {
        return await replica.query<R>(text, values);
      } catch (err) {
        replicaSkippedUntil = now() + cooldownMs;
        log.warn({ err, cooldownMs }, 'Read replica query failed; retrying on the primary and skipping the replica during the cooldown');
        return primary.query<R>(text, values);
      }
    },
  };
}

const readDatabaseUrl = optionalEnv('READ_DATABASE_URL');

/**
 * `connectionTimeoutMillis` bounds how long an unreachable replica can delay
 * a request before the fallback runs; `pg`'s default is to wait
 * indefinitely. Two seconds is far above a same-host connect.
 */
export const replicaPool: Pool | null = readDatabaseUrl
  ? new Pool({ connectionString: readDatabaseUrl, connectionTimeoutMillis: 2000 })
  : null;

// The same failure the primary's handler above exists for, and just as
// likely here: restarting the replica sends 57P01 to its idle clients, and
// without a listener that would crash the API.
replicaPool?.on('error', (err) => {
  logger.error({ err }, 'Idle read-replica client errored and was removed from the pool (e.g. a server restart); continuing');
});

export const readDb: Queryable = createReadDb(pool, replicaPool, logger);
