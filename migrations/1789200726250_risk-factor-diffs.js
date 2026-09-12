/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * Stores the result of diffing a company's two most recent 10-Ks' Risk
 * Factors sections (Phase 5 step 4's `diffRiskFactorTexts()`). Unlike the
 * ratio scores (deliberately left unpersisted - cheap to recompute from
 * `filing_facts` on demand), a risk-factor diff involves embedding every
 * chunk of a real 10-K's Risk Factors section (100+ chunks, each a real
 * local model inference) - genuinely expensive to redo on every API
 * request, so this is cached rather than recomputed each time.
 *
 * `chunks` and `summary` are jsonb rather than further EAV rows - the diff
 * is a single nested, list-shaped result naturally suited to one document,
 * not a set of independently-queryable facts.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.createTable('filing_risk_factor_diffs', {
    id: 'id',
    cik: { type: 'char(10)', notNull: true, references: 'companies', onDelete: 'CASCADE' },
    current_accn: { type: 'text', notNull: true },
    current_filing_date: { type: 'date', notNull: true },
    prior_accn: { type: 'text', notNull: true },
    prior_filing_date: { type: 'date', notNull: true },
    summary: { type: 'jsonb', notNull: true },
    chunks: { type: 'jsonb', notNull: true },
    computed_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('filing_risk_factor_diffs', 'filing_risk_factor_diffs_unique_pair', {
    unique: ['cik', 'current_accn', 'prior_accn'],
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable('filing_risk_factor_diffs');
};
