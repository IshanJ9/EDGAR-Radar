/**
 * DO NOT COMMIT. Temporary fixture for Phase 6's failure-case test:
 * "a deploy with a broken migration fails the pipeline before reaching prod."
 *
 * Deliberately broken in a realistic way - a typo'd table name, the kind of
 * mistake that is syntactically valid SQL and only fails when it actually runs
 * against a database - rather than a JavaScript syntax error, which would be a
 * much weaker test of the pipeline. Deleted immediately after the test.
 */
exports.up = (pgm) => {
  pgm.sql('ALTER TABLE companys ADD COLUMN failure_case_test_column integer;');
};

exports.down = (pgm) => {
  pgm.sql('ALTER TABLE companys DROP COLUMN failure_case_test_column;');
};
