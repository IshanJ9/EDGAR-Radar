/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.createTable('reconciliation_runs', {
    id: 'id',
    started_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    finished_at: { type: 'timestamptz' },
    status: { type: 'text', notNull: true, default: 'running' },
    companies_checked: { type: 'integer', notNull: true, default: 0 },
    companies_missing_from_bulk: { type: 'integer', notNull: true, default: 0 },
    discrepancies_found: { type: 'integer', notNull: true, default: 0 },
  });

  pgm.addConstraint('reconciliation_runs', 'reconciliation_runs_status_check', {
    check: "status IN ('running', 'completed', 'failed')",
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable('reconciliation_runs');
};
