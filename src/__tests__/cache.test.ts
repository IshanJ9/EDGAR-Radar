/**
 * Phase 7, step 3 - the response cache (src/cache.ts), with a fake client:
 * no Redis is involved. Real behaviour against a running and a stopped
 * `redis-cache` container was verified separately (see PROGRESS.md).
 */
import { cacheKeys, CacheClient, createResponseCache } from '../cache';

function fakeClient(overrides: Partial<Record<keyof CacheClient, jest.Mock>> = {}) {
  const store = new Map<string, string>();
  return {
    store,
    get: overrides.get ?? jest.fn(async (key: string) => store.get(key) ?? null),
    set: overrides.set ?? jest.fn(async (key: string, value: string) => void store.set(key, value)),
    del: overrides.del ?? jest.fn(async (...keys: string[]) => keys.filter((k) => store.delete(k)).length),
  };
}

const down = () => jest.fn(async () => {
  throw new Error("Stream isn't writeable and enableOfflineQueue options is false");
});

describe('cacheKeys', () => {
  // Routes accept both forms for the same company, and writers always use the
  // padded one. If the keys differed, invalidation would clear one entry and
  // leave the other serving stale data.
  test('padded and unpadded CIKs give the same key, so invalidation reaches every entry', () => {
    expect(cacheKeys.company('320193')).toBe(cacheKeys.company('0000320193'));
    expect(cacheKeys.facts('320193')).toBe(cacheKeys.facts('0000320193'));
    expect(cacheKeys.riskFactorDiff('320193')).toBe(cacheKeys.riskFactorDiff('0000320193'));
  });

  test('each endpoint has its own key', () => {
    const keys = [cacheKeys.company('1'), cacheKeys.facts('1'), cacheKeys.riskFactorDiff('1')];
    expect(new Set(keys).size).toBe(3);
  });
});

describe('createResponseCache', () => {
  test('with no client configured, every read is a miss and writes do nothing', async () => {
    const cache = createResponseCache(null, { warn: jest.fn() });
    await cache.set('k', 'v');
    await cache.invalidate('k');
    await expect(cache.get('k')).resolves.toBeNull();
  });

  test('stores bodies with the TTL, and returns them', async () => {
    const client = fakeClient();
    const cache = createResponseCache(client, { warn: jest.fn() }, { ttlSeconds: 300 });

    await cache.set('k', '{"a":1}');

    expect(client.set).toHaveBeenCalledWith('k', '{"a":1}', 'EX', 300);
    await expect(cache.get('k')).resolves.toBe('{"a":1}');
  });

  describe('fails open - an unavailable cache is a miss, never an error', () => {
    test('a failed read is a miss', async () => {
      const cache = createResponseCache(fakeClient({ get: down() }), { warn: jest.fn() });
      await expect(cache.get('k')).resolves.toBeNull();
    });

    test('failed writes and deletions do not throw', async () => {
      const cache = createResponseCache(fakeClient({ set: down(), del: down() }), { warn: jest.fn() }, { schedule: () => undefined });
      await expect(cache.set('k', 'v')).resolves.toBeUndefined();
      await expect(cache.invalidate('k')).resolves.toBeUndefined();
    });

    test('an outage logs one warning per window, not one per request', async () => {
      let clock = 0;
      const log = { warn: jest.fn() };
      const cache = createResponseCache(fakeClient({ get: down() }), log, { warnEveryMs: 30_000, now: () => clock });

      for (let i = 0; i < 10; i++) await cache.get('k');
      expect(log.warn).toHaveBeenCalledTimes(1);

      clock += 30_000;
      await cache.get('k');
      expect(log.warn).toHaveBeenCalledTimes(2);
    });
  });

  describe('invalidate', () => {
    test('deletes the keys immediately', async () => {
      const client = fakeClient();
      client.store.set('a', '1');
      client.store.set('b', '2');
      const cache = createResponseCache(client, { warn: jest.fn() }, { schedule: () => undefined });

      await cache.invalidate('a', 'b');

      expect(client.store.has('a')).toBe(false);
      expect(client.store.has('b')).toBe(false);
    });

    // The race this guards against: a read that began before the write stores
    // the old body after the first deletion. The second deletion removes it.
    test('deletes again after the repeat delay, removing a stale body stored in between', async () => {
      const client = fakeClient();
      const scheduled: Array<{ fn: () => void; ms: number }> = [];
      const cache = createResponseCache(client, { warn: jest.fn() }, {
        repeatAfterMs: 2000,
        schedule: (fn, ms) => void scheduled.push({ fn, ms }),
      });

      await cache.invalidate('k');
      await cache.set('k', 'stale body from a read that started before the write');
      expect(client.store.has('k')).toBe(true);

      expect(scheduled).toHaveLength(1);
      expect(scheduled[0]!.ms).toBe(2000);
      scheduled[0]!.fn();
      await new Promise((resolve) => setImmediate(resolve));

      expect(client.store.has('k')).toBe(false);
      expect(client.del).toHaveBeenCalledTimes(2);
    });

    test('with no keys, touches nothing', async () => {
      const client = fakeClient();
      const schedule = jest.fn();
      await createResponseCache(client, { warn: jest.fn() }, { schedule }).invalidate();
      expect(client.del).not.toHaveBeenCalled();
      expect(schedule).not.toHaveBeenCalled();
    });
  });
});
