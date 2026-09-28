/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * Every filing the poller has put on the `filing.discovered` queue, keyed by
 * SEC's accession number (unique per filing across all of EDGAR).
 *
 * SEC dates a filing without a time, so the poller can't tell from the date
 * alone whether it has already seen a filing made earlier the same day. It
 * therefore looks back a fixed window of days on every cycle and uses this
 * table to enqueue each filing exactly once (Post-Phase 7, step 5).
 *
 * `cik` deliberately has no foreign key to `companies`: the poller watches
 * the whole universe, including companies not yet stored.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.createTable('discovered_filings', {
    accession_number: { type: 'text', primaryKey: true },
    cik: { type: 'char(10)', notNull: true },
    form: { type: 'text', notNull: true },
    filing_date: { type: 'date', notNull: true },
    discovered_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable('discovered_filings');
};
