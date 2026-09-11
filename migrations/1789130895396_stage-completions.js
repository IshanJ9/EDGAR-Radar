/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * Idempotency ledger for the Phase 4 worker pipeline: records that a given
 * filing (by accession number) has reached a given stage ('parsed',
 * 'scored', 'notified'), so a redelivered/retried BullMQ job (at-least-once
 * delivery - e.g. a worker crashing after doing its work but before the job
 * is acked) can be detected and its non-idempotent side effect (enqueuing
 * the next stage, sending an alert) skipped, rather than duplicated. DB
 * upserts elsewhere in the pipeline are already naturally idempotent and
 * don't need this - this exists specifically for side effects that aren't.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.createTable('stage_completions', {
    id: 'id',
    accession_number: { type: 'text', notNull: true },
    stage: { type: 'text', notNull: true },
    completed_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('stage_completions', 'stage_completions_accn_stage_unique', {
    unique: ['accession_number', 'stage'],
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable('stage_completions');
};
