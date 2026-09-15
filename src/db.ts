import { Pool, types } from 'pg';
import { requireEnv } from './config';
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
