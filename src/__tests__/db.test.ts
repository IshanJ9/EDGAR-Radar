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
import { QueryResult } from 'pg';
import { createReadDb, pool, Queryable, replicaPool } from '../db';

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

/**
 * Phase 7, step 2 - the read replica. The fallback is tested through
 * `createReadDb` with fake databases, so no server is involved; the real
 * behaviour against a stopped replica container was verified separately (see
 * PROGRESS.md).
 */
function fakeDb(name: string, fail = false): Queryable & { query: jest.Mock } {
  return {
    query: jest.fn(async () => {
      if (fail) throw new Error(`${name} is unreachable`);
      return { rows: [{ answeredBy: name }] } as unknown as QueryResult;
    }),
  };
}

describe('read replica routing (createReadDb)', () => {
  test('with no replica configured, reads go straight to the primary', () => {
    const primary = fakeDb('primary');
    expect(createReadDb(primary, null, { warn: jest.fn() })).toBe(primary);
  });

  test('a healthy replica answers, and the primary is never touched', async () => {
    const primary = fakeDb('primary');
    const replica = fakeDb('replica');
    const log = { warn: jest.fn() };

    const result = await createReadDb(primary, replica, log).query('SELECT 1', ['x']);

    expect(result.rows).toEqual([{ answeredBy: 'replica' }]);
    expect(replica.query).toHaveBeenCalledWith('SELECT 1', ['x']);
    expect(primary.query).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });

  test('a failing replica costs one attempt: the same query is answered by the primary, with a warning', async () => {
    const primary = fakeDb('primary');
    const replica = fakeDb('replica', true);
    const log = { warn: jest.fn() };

    const result = await createReadDb(primary, replica, log).query('SELECT 1', ['x']);

    expect(result.rows).toEqual([{ answeredBy: 'primary' }]);
    expect(primary.query).toHaveBeenCalledWith('SELECT 1', ['x']);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  test('if the primary fails too, that error reaches the caller rather than being swallowed', async () => {
    const readDb = createReadDb(fakeDb('primary', true), fakeDb('replica', true), { warn: jest.fn() });
    await expect(readDb.query('SELECT 1')).rejects.toThrow('primary is unreachable');
  });

  // The circuit breaker. Measured against a stopped replica container, every
  // read took ~3.4s without it, because each one waited ~2.5s for Docker's DNS
  // to report the replica's hostname gone.
  describe('after a replica failure (circuit breaker)', () => {
    function setUp() {
      let clock = 1_000_000;
      const primary = fakeDb('primary');
      const replica = fakeDb('replica', true);
      const log = { warn: jest.fn() };
      const readDb = createReadDb(primary, replica, log, { cooldownMs: 30_000, now: () => clock });
      return { primary, replica, log, readDb, advance: (ms: number) => (clock += ms) };
    }

    test('reads skip the replica entirely during the cooldown, with one warning in total', async () => {
      const { primary, replica, log, readDb, advance } = setUp();

      await readDb.query('SELECT 1'); // trips the breaker
      for (let i = 0; i < 5; i++) {
        advance(5_000); // still inside the 30s cooldown
        await expect(readDb.query('SELECT 1')).resolves.toEqual({ rows: [{ answeredBy: 'primary' }] });
      }

      expect(replica.query).toHaveBeenCalledTimes(1);
      expect(primary.query).toHaveBeenCalledTimes(6);
      expect(log.warn).toHaveBeenCalledTimes(1);
    });

    test('once the cooldown passes, the replica is tried again - and is used if it has recovered', async () => {
      const { replica, readDb, advance } = setUp();

      await readDb.query('SELECT 1'); // trips the breaker
      replica.query.mockResolvedValue({ rows: [{ answeredBy: 'replica' }] }); // the replica comes back
      advance(30_000);

      await expect(readDb.query('SELECT 1')).resolves.toEqual({ rows: [{ answeredBy: 'replica' }] });
      expect(replica.query).toHaveBeenCalledTimes(2);
    });
  });
});

describe('read replica pool', () => {
  test('is not created when READ_DATABASE_URL is unset - the default for unit tests, host-based dev and every worker', () => {
    expect(replicaPool).toBeNull();
  });

  // The Phase 3 crash, on the new pool: restarting the replica sends 57P01 to
  // its idle clients, and an 'error' event with no listener would take the
  // whole API down. Loaded in isolation so this file's other tests keep the
  // no-replica module; the `.invalid` host can never resolve, and nothing
  // queries it.
  test('when configured, handles an idle-client error (e.g. a replica restart) instead of crashing', async () => {
    const saved = process.env.READ_DATABASE_URL;
    process.env.READ_DATABASE_URL = 'postgresql://placeholder:placeholder@replica-never-connects.invalid:5432/placeholder';
    try {
      let isolated: typeof import('../db') | undefined;
      jest.isolateModules(() => {
        isolated = jest.requireActual<typeof import('../db')>('../db');
      });
      const replica = isolated!.replicaPool!;
      expect(replica).not.toBeNull();
      expect(replica.listenerCount('error')).toBeGreaterThan(0);

      const replicaRestart = Object.assign(new Error('terminating connection due to administrator command'), {
        code: '57P01',
        severity: 'FATAL',
      });
      expect(() => replica.emit('error', replicaRestart, {})).not.toThrow();

      await replica.end();
      await isolated!.pool.end();
    } finally {
      if (saved === undefined) delete process.env.READ_DATABASE_URL;
      else process.env.READ_DATABASE_URL = saved;
    }
  });
});
