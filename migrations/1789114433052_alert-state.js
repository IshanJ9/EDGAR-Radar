/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * Tracks when we last sent each kind of alert, so a prolonged outage sends
 * one notification and then throttles - not a fresh Slack message every time
 * the heartbeat check runs (e.g. every 15 minutes) for the same ongoing issue.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.createTable('alert_state', {
    alert_type: { type: 'text', primaryKey: true },
    last_alerted_at: { type: 'timestamptz', notNull: true },
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable('alert_state');
};
