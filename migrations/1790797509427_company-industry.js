/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * Each company's industry, from SEC's Standard Industrial Classification
 * (post-Phase 7 hardening, step 3, F1b) - so the frontend can say "these
 * scores don't fit banks" instead of showing a blank, and label companies.
 *
 * Filled by the poller from the submissions document it already downloads
 * every 30 minutes (`sic`, `sicDescription`), so it costs no extra SEC
 * requests. Nullable: a company has none until the poller has seen it.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.addColumns('companies', {
    sic: { type: 'text' },
    sic_description: { type: 'text' },
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropColumns('companies', ['sic', 'sic_description']);
};
