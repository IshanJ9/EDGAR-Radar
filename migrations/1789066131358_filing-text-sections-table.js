/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * `content_tsv` is a generated column (auto-maintained by Postgres whenever
 * `content` changes, no application-level trigger needed) with a GIN index
 * for actual fast full-text search - a tsvector column without an index on
 * it would just be dead weight at any real scale.
 *
 * `section_name` defaults to 'full_document' for now (this step just
 * extracts one filing's whole plaintext); real Item-level segmentation
 * (e.g. "Item 1A. Risk Factors") is Phase 5's job, not this one, but the
 * table already supports multiple rows per filing when that lands.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.createTable('filing_text_sections', {
    id: 'id',
    cik: {
      type: 'char(10)',
      notNull: true,
      references: 'companies',
      onDelete: 'CASCADE',
    },
    accn: { type: 'text', notNull: true },
    form: { type: 'text', notNull: true },
    filing_date: { type: 'date', notNull: true },
    section_name: { type: 'text', notNull: true, default: 'full_document' },
    content: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('filing_text_sections', 'filing_text_sections_unique_section', {
    unique: ['cik', 'accn', 'section_name'],
  });

  pgm.sql(`
    ALTER TABLE filing_text_sections
    ADD COLUMN content_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
  `);

  pgm.sql(`CREATE INDEX filing_text_sections_tsv_idx ON filing_text_sections USING GIN (content_tsv)`);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable('filing_text_sections');
};
