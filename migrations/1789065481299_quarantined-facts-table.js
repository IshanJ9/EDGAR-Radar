/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * Every column here (besides id/reason/quarantined_at) is a raw TEXT column
 * on purpose, even ones that "should" be numeric/date - the whole point of
 * quarantine is that a malformed value must never itself fail to insert
 * (e.g. a non-numeric `value` would reject a `numeric` column, a malformed
 * date string would reject a `date` column). Storing everything as text
 * guarantees quarantining a bad record can't become another crash.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.createTable('quarantined_facts', {
    id: 'id',
    cik: { type: 'text', notNull: true },
    tag: { type: 'text' },
    unit: { type: 'text' },
    raw_value: { type: 'text' },
    period_start: { type: 'text' },
    period_end: { type: 'text' },
    fiscal_year: { type: 'text' },
    fiscal_period: { type: 'text' },
    form: { type: 'text' },
    accn: { type: 'text' },
    filed_date: { type: 'text' },
    reason: { type: 'text', notNull: true },
    quarantined_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('quarantined_facts', 'cik');
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable('quarantined_facts');
};
