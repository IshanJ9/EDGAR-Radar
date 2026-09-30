/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * Relabels every stored annual 10-K value with the fiscal year of its own
 * period (post-Phase 7 hardening, step 3, F1b).
 *
 * Until now `fiscal_year` held SEC's `fy` - the fiscal year of the FILING
 * that reported the value. A 10-K restates earlier years under its own `fy`,
 * so a comparative figure was labelled as the current year: Apple's stored
 * "fiscal 2025" revenue was the year ended 2023-09-30. The values themselves
 * are real; only the labels were wrong. The label is now the calendar year
 * the period ends in (src/sec.ts, fiscalYearOfPeriod), and upsertFact writes
 * it that way from here on.
 *
 * Quarterly rows keep SEC's `fy`: nothing compares them by fiscal year.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.sql(`
    UPDATE filing_facts
    SET fiscal_year = EXTRACT(YEAR FROM period_end)::int
    WHERE form = '10-K' AND fiscal_period = 'FY'
      AND fiscal_year IS DISTINCT FROM EXTRACT(YEAR FROM period_end)::int
  `);
};

/**
 * Deliberately a no-op: the old labels were wrong, and the filing's `fy` they
 * came from is not stored separately, so there is nothing correct to restore.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = () => {};
