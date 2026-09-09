/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.createTable('filing_facts', {
    id: 'id',
    cik: {
      type: 'char(10)',
      notNull: true,
      references: 'companies',
      onDelete: 'CASCADE',
    },
    tag: { type: 'text', notNull: true },
    unit: { type: 'text', notNull: true, default: 'USD' },
    value: { type: 'numeric', notNull: true },
    period_end: { type: 'date', notNull: true },
    fiscal_year: { type: 'integer' },
    fiscal_period: { type: 'text' },
    form: { type: 'text' },
    filed_date: { type: 'date' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('filing_facts', 'filing_facts_unique_fact', {
    unique: ['cik', 'tag', 'unit', 'period_end', 'form'],
  });

  pgm.createIndex('filing_facts', 'cik');
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable('filing_facts');
};
