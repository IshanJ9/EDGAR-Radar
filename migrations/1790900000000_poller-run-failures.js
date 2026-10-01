/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * How many companies each poll cycle could NOT check (post-Phase 7
 * hardening, step 5). \`companies_checked\` counts every company a cycle
 * attempts, so a poller that SEC blocks still completes each cycle with
 * "196 checked" - the heartbeat could not tell it from a healthy one. With
 * this it alerts when most checks fail. Runs recorded before this column
 * read 0, which is what they would have reported: the column did not exist.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.addColumns('poller_runs', {
    companies_failed: { type: 'integer', notNull: true, default: 0 },
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropColumns('poller_runs', ['companies_failed']);
};
