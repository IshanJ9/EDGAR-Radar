import { Pool, types } from 'pg';

// pg's default DATE parser converts 'YYYY-MM-DD' into a JS Date at local
// midnight, then callers that read it back via toISOString() (or any code,
// like reconciliation's comparisons, that treats it as a string) see it
// shifted by the local timezone offset - e.g. '2026-06-27' round-trips as
// '2026-06-26T18:30:00.000Z' in UTC+5:30. Returning the raw string instead
// avoids the whole class of bug: DATE columns have no time/timezone
// component in Postgres, so there's nothing a JS Date usefully adds.
types.setTypeParser(types.builtins.DATE, (value) => value);

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Backported for the Phase 3 48h re-run (tag phase-3-complete-v3). A Postgres
// restart sends FATAL 57P01 to every connected client; for a client idle in
// the pool, `pg` emits that as an 'error' event on the pool, and with no
// listener Node treats it as an uncaught exception and the process exits.
// That is how the poller died on 2026-09-12, when an Ubuntu unattended-upgrade
// restarted Postgres. The pool has already removed the broken client when this
// fires, so logging is enough; the next query reconnects. console.error rather
// than a logger module, because this Phase 3 codebase has none (pino arrived in
// Phase 6, where the same handler exists in src/db.ts).
pool.on('error', (err) => {
  console.error(`[${new Date().toISOString()}] Idle Postgres client errored and was removed from the pool (e.g. a server restart); continuing:`, err.message);
});
