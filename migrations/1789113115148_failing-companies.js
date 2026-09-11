/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * Distinct from `quarantined_facts` (Phase 2 step 5 - a single bad VALUE
 * within an otherwise-successful fetch) and step 3's per-request HTTP
 * retry (a single HTTP call failing transiently, retried within seconds).
 * This tracks a company FAILING TO INGEST AT ALL, repeatedly, ACROSS
 * separate attempts over time (different poll cycles / backfill runs) -
 * the roadmap's "permanently failing filing" case. Once
 * `consecutive_failures` crosses the threshold, `quarantined_at` is set and
 * the poller/backfill skip that company automatically instead of retrying
 * it forever every cycle; a human clears it after investigating.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.createTable('failing_companies', {
    cik: { type: 'char(10)', primaryKey: true },
    consecutive_failures: { type: 'integer', notNull: true, default: 0 },
    last_error: { type: 'text' },
    last_attempted_at: { type: 'timestamptz' },
    quarantined_at: { type: 'timestamptz' },
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable('failing_companies');
};
