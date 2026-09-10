/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * Two tables to make the backfill script resumable:
 * - ingestion_runs: one row per backfill execution.
 * - ingestion_run_companies: one row per (run, company) - a manifest of
 *   every company that run needs to process, and whether it has. On
 *   restart after a kill, the script resumes the most recent 'running'
 *   run and only re-processes companies still 'pending' in it, instead
 *   of starting over or blindly reprocessing everything.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.createTable('ingestion_runs', {
    id: 'id',
    started_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    finished_at: { type: 'timestamptz' },
    status: { type: 'text', notNull: true, default: 'running' },
    total_companies: { type: 'integer', notNull: true },
  });

  pgm.addConstraint('ingestion_runs', 'ingestion_runs_status_check', {
    check: "status IN ('running', 'completed', 'failed')",
  });

  pgm.createTable('ingestion_run_companies', {
    id: 'id',
    run_id: {
      type: 'integer',
      notNull: true,
      references: 'ingestion_runs',
      onDelete: 'CASCADE',
    },
    cik: { type: 'char(10)', notNull: true },
    status: { type: 'text', notNull: true, default: 'pending' },
    error_message: { type: 'text' },
    processed_at: { type: 'timestamptz' },
  });

  pgm.addConstraint('ingestion_run_companies', 'ingestion_run_companies_status_check', {
    check: "status IN ('pending', 'success', 'failed')",
  });
  pgm.addConstraint('ingestion_run_companies', 'ingestion_run_companies_unique_run_cik', {
    unique: ['run_id', 'cik'],
  });
  pgm.createIndex('ingestion_run_companies', ['run_id', 'status']);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable('ingestion_run_companies');
  pgm.dropTable('ingestion_runs');
};
