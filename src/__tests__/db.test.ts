/**
 * Regression test for the Postgres pool's error handler (src/db.ts).
 *
 * Phase 3's real-world 48h run died this way on 2026-09-12: an Ubuntu
 * unattended-upgrade restarted Postgres, the server sent FATAL 57P01 to every
 * connected client, and for a client sitting idle in the pool `pg` emits that
 * as an 'error' event on the pool. With no listener, Node treats an emitted
 * 'error' as an uncaught exception, and the poller process exited and stayed
 * dead (see PROGRESS.md).
 *
 * Emitting an 'error' event with no listener throws synchronously, so the
 * second test fails the moment the handler is removed. Nothing here connects
 * to a database: creating a Pool is lazy, and jest.setup.ts supplies a
 * placeholder DATABASE_URL on a reserved `.invalid` host. The real behaviour
 * against a genuinely restarting Postgres was verified separately.
 */
import { pool } from '../db';

afterAll(async () => {
  await pool.end();
});

describe('Postgres pool error handling', () => {
  test('has an error listener registered', () => {
    expect(pool.listenerCount('error')).toBeGreaterThan(0);
  });

  test('an idle-client error (e.g. a server restart) is handled instead of crashing the process', () => {
    const serverRestart = Object.assign(new Error('terminating connection due to administrator command'), {
      code: '57P01',
      severity: 'FATAL',
    });
    expect(() => pool.emit('error', serverRestart, {})).not.toThrow();
  });
});
