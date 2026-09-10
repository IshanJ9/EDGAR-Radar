/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * Step 2 deliberately made filing_facts a "last-known-value" cache: the
 * same real-world period reported again (e.g. a restatement) would UPDATE
 * the existing row in place, overwriting the prior figure. That was an
 * intentional stepping stone, documented at the time as deferring real
 * history to this step. Now the same-period-different-filing case should
 * APPEND a new row instead of overwriting, with `effective_from` recording
 * when that value became the known-true figure (the filing's own `filed`
 * date, not our ingestion time - that's when the correction became public).
 *
 * The uniqueness key gains `accn` (the filing's accession number) so a
 * genuine restatement (different accn, same period) can append, while
 * re-ingesting the *same* filing again (same accn) still idempotently
 * updates that one row rather than duplicating it.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.addColumn('filing_facts', {
    effective_from: { type: 'date' },
  });

  // Existing rows already have a real filed_date from step 2 onward - backfill
  // effective_from from it rather than losing/truncating real ingested data.
  pgm.sql('UPDATE filing_facts SET effective_from = filed_date WHERE effective_from IS NULL');

  pgm.alterColumn('filing_facts', 'effective_from', { notNull: true });

  pgm.sql('DROP INDEX filing_facts_unique_period');

  pgm.sql(`
    CREATE UNIQUE INDEX filing_facts_unique_filing_period
    ON filing_facts (cik, tag, unit, period_end, COALESCE(period_start, '0001-01-01'), accn)
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.sql('DROP INDEX filing_facts_unique_filing_period');
  pgm.sql(`
    CREATE UNIQUE INDEX filing_facts_unique_period
    ON filing_facts (cik, tag, unit, period_end, COALESCE(period_start, '0001-01-01'))
  `);
  pgm.dropColumn('filing_facts', 'effective_from');
};
