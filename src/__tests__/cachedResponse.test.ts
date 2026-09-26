/**
 * Phase 7, step 3 - the route-side half of the response cache
 * (src/routes/cachedResponse.ts), with the cache mocked and a minimal fake
 * Express response. Nothing connects anywhere.
 */
jest.mock('../cache', () => ({
  responseCache: { get: jest.fn(), set: jest.fn() },
}));

import { Response } from 'express';
import { responseCache } from '../cache';
import { sendAndCache, sendIfCached } from '../routes/cachedResponse';

function fakeRes() {
  const res = {
    headers: {} as Record<string, string>,
    contentType: undefined as string | undefined,
    body: undefined as unknown,
    set(name: string, value: string) {
      res.headers[name] = value;
      return res;
    },
    type(t: string) {
      res.contentType = t;
      return res;
    },
    send(b: unknown) {
      res.body = b;
      return res;
    },
  };
  return res;
}
const asResponse = (r: ReturnType<typeof fakeRes>) => r as unknown as Response;

const get = responseCache.get as jest.Mock;
const set = responseCache.set as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  set.mockResolvedValue(undefined);
});

describe('sendIfCached', () => {
  test('on a hit, sends the stored body as JSON with X-Cache: HIT and reports true', async () => {
    get.mockResolvedValue('{"cik":"0000320193"}');
    const res = fakeRes();

    await expect(sendIfCached(asResponse(res), 'k')).resolves.toBe(true);

    expect(res.body).toBe('{"cik":"0000320193"}');
    expect(res.headers['X-Cache']).toBe('HIT');
    expect(res.contentType).toBe('application/json');
  });

  test('on a miss, sends nothing and reports false, so the route computes the answer', async () => {
    get.mockResolvedValue(null);
    const res = fakeRes();

    await expect(sendIfCached(asResponse(res), 'k')).resolves.toBe(false);

    expect(res.body).toBeUndefined();
    expect(res.headers).toEqual({});
  });
});

describe('sendAndCache', () => {
  test('sends the body with X-Cache: MISS and stores exactly the string it sent', () => {
    const res = fakeRes();
    const body = { cik: '0000320193', entityName: 'Apple Inc.', facts: [{ tag: 'Revenues' }] };

    sendAndCache(asResponse(res), 'k', body);

    expect(res.headers['X-Cache']).toBe('MISS');
    expect(res.contentType).toBe('application/json');
    expect(JSON.parse(res.body as string)).toEqual(body);
    // Byte-for-byte: a later hit must return what this miss returned.
    expect(set).toHaveBeenCalledWith('k', res.body);
  });

  test('never stores a null body - it is sent, but a later request recomputes it', () => {
    const res = fakeRes();
    sendAndCache(asResponse(res), 'k', null);
    expect(res.body).toBe('null');
    expect(set).not.toHaveBeenCalled();
  });
});
