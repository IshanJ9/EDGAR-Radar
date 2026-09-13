import { Pool, types } from 'pg';
import { requireEnv } from './config';

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
