/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * Phase 1's filing_facts only ever stored one hand-picked value (Revenues,
 * NetIncomeLoss) per company. Phase 2 ingests every tag/period SEC reports,
 * which surfaces a real XBRL quirk: duration facts (e.g. quarterly vs.
 * year-to-date revenue) routinely share the same period_end but have
 * different period_start dates. Without period_start in the uniqueness key,
 * upserting the full history would silently overwrite one figure with the
 * other. `form` is dropped from the key because the same real-world period
 * can legitimately be reported again under a different filing type
 * (comparative figures) - we want that to update the existing row, not
 * collide or duplicate it. `accn` (the filing's accession number) is kept
 * as an informational lineage column, not part of the uniqueness key.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  // Existing rows are just ad hoc smoke-test data from Phase 1 (2 facts per
  // company, no accn recorded) - not worth backfilling by hand since Phase 2's
  // backfill script will properly re-ingest everything.
  pgm.sql('TRUNCATE TABLE filing_facts');

  pgm.dropConstraint('filing_facts', 'filing_facts_unique_fact');

  pgm.addColumns('filing_facts', {
    period_start: { type: 'date' },
    accn: { type: 'text', notNull: true },
  });

  pgm.sql(`
    CREATE UNIQUE INDEX filing_facts_unique_period
    ON filing_facts (cik, tag, unit, period_end, COALESCE(period_start, '0001-01-01'))
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.sql('DROP INDEX filing_facts_unique_period');
  pgm.dropColumns('filing_facts', ['period_start', 'accn']);
  pgm.addConstraint('filing_facts', 'filing_facts_unique_fact', {
    unique: ['cik', 'tag', 'unit', 'period_end', 'form'],
  });
};
