/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * `poller_state` is a single-row table holding the cursor - the timestamp up
 * to which we've confirmed all filings have been checked. `poller_runs` is a
 * history log of each poll cycle, mirroring `ingestion_runs`' shape, for
 * observability (how many companies were checked, how many new filings
 * found, whether it succeeded).
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.createTable('poller_state', {
    id: { type: 'integer', primaryKey: true },
    last_checked_at: { type: 'timestamptz', notNull: true },
  });

  pgm.createTable('poller_runs', {
    id: 'id',
    started_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    finished_at: { type: 'timestamptz' },
    status: { type: 'text', notNull: true, default: 'running' },
    companies_checked: { type: 'integer', notNull: true, default: 0 },
    new_filings_found: { type: 'integer', notNull: true, default: 0 },
  });

  pgm.addConstraint('poller_runs', 'poller_runs_status_check', {
    check: "status IN ('running', 'completed', 'failed')",
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable('poller_runs');
  pgm.dropTable('poller_state');
};
