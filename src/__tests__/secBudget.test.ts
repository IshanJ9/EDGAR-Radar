/**
 * The SEC request budget (post-Phase 7, step 1).
 *
 * SEC allows 10 requests per second from this host. Several processes call
 * it, each limited only by its own token bucket, so the guarantee lives in
 * configuration: docker-compose.yml gives each SEC-calling service a share,
 * and a bucket admits at most `capacity + rate` requests in any one-second
 * window. These tests read the real docker-compose.yml, so an edit that lets
 * the shares add up past the limit fails here instead of in production.
 */
import { readFileSync } from 'fs';
import * as path from 'path';
import { TokenBucket } from '../rateLimiter';
import { findEnvProblems } from '../config';
import { SEC_BURST_CAPACITY } from '../sec';

/** Every service in docker-compose.yml whose code can call SEC. */
const SEC_CALLERS = ['api', 'worker-parser', 'poller', 'reconcile'];

/** Service name -> its SEC_REQUESTS_PER_SECOND value, if it sets one. */
function secSharesFromCompose(): Map<string, string | undefined> {
  const text = readFileSync(path.join(__dirname, '..', '..', 'docker-compose.yml'), 'utf8').replace(/\r\n/g, '\n');
  const servicesBlock = text.split(/^services:\n/m)[1]!.split(/^\S/m)[0]!;
  const shares = new Map<string, string | undefined>();
  for (const block of servicesBlock.split(/^(?= {2}[a-z0-9-]+:\s*$)/m)) {
    const name = block.match(/^ {2}([a-z0-9-]+):/)?.[1];
    if (!name) continue;
    shares.set(name, block.match(/^\s+SEC_REQUESTS_PER_SECOND:\s*"?([^"\s]+)"?\s*$/m)?.[1]);
  }
  return shares;
}

describe('SEC request budget in docker-compose.yml', () => {
  const shares = secSharesFromCompose();

  test('the parser found the services, so the checks below are not passing vacuously', () => {
    for (const service of SEC_CALLERS) {
      expect(shares.has(service)).toBe(true);
    }
  });

  test.each(SEC_CALLERS)('%s sets its share explicitly, rather than falling back to the standalone default of 7', (service) => {
    expect(shares.get(service)).toBeDefined();
  });

  test('only SEC-calling services are given a share', () => {
    const withShare = [...shares].filter(([, rate]) => rate !== undefined).map(([name]) => name);
    expect(withShare.sort()).toEqual([...SEC_CALLERS].sort());
  });

  test('every share is a value the services would accept at startup', () => {
    for (const service of SEC_CALLERS) {
      expect(findEnvProblems('api', { ...VALID_ENV, SEC_REQUESTS_PER_SECOND: shares.get(service)! })).toEqual([]);
    }
  });

  test('no alignment of bursts can exceed 10 requests in any one-second window', () => {
    const worstSecond = SEC_CALLERS.reduce((sum, service) => sum + Number(shares.get(service)) + SEC_BURST_CAPACITY, 0);
    expect(worstSecond).toBeLessThanOrEqual(10);
  });

  test('the sustained total stays inside CLAUDE.md\'s 5-8 per second guidance', () => {
    const sustained = SEC_CALLERS.reduce((sum, service) => sum + Number(shares.get(service)), 0);
    expect(sustained).toBeLessThanOrEqual(8);
  });
});

const VALID_ENV = {
  DATABASE_URL: 'postgresql://postgres:postgres@postgres:5432/edgar_radar',
  REDIS_URL: 'redis://redis:6379',
  EDGAR_CONTACT_EMAIL: 'contact@example.com',
  JWT_SECRET: 'a-long-random-test-secret',
};

// The budget arithmetic above assumes a bucket can never admit more than
// `capacity + rate` requests in a second. Checked against the real
// TokenBucket with real time, at rates high enough to keep the test short.
describe('TokenBucket, as the budget relies on it', () => {
  test('with a capacity of 1 there is no burst: requests are spaced at the rate from the first one', async () => {
    const bucket = new TokenBucket(20, 1); // one token per 50 ms
    const start = Date.now();
    for (let i = 0; i < 11; i++) await bucket.acquire();
    // 1 immediately, then 10 more at 50 ms each.
    expect(Date.now() - start).toBeGreaterThanOrEqual(480);
  });

  test('a full bucket admits no more than capacity + rate in a window', async () => {
    const bucket = new TokenBucket(20, 5);
    const start = Date.now();
    let admitted = 0;
    while (Date.now() - start < 500) {
      await bucket.acquire();
      if (Date.now() - start < 500) admitted += 1;
    }
    // capacity 5 + 20/s over 0.5 s = 15 at most.
    expect(admitted).toBeLessThanOrEqual(15);
  });

  // The case that matters in production: a process that has been idle - the
  // poller between cycles, the API between cold fetches - must not have
  // banked tokens for the time it was quiet and then fire them all at once.
  test('idle time does not accumulate beyond the capacity', async () => {
    const bucket = new TokenBucket(20, 1);
    await bucket.acquire();
    await new Promise((resolve) => setTimeout(resolve, 500)); // 10 tokens' worth of idle time
    const start = Date.now();
    let admitted = 0;
    while (Date.now() - start < 250) {
      await bucket.acquire();
      if (Date.now() - start < 250) admitted += 1;
    }
    // capacity 1 + 20/s over 0.25 s = 6 at most; without the cap it would be ~16.
    expect(admitted).toBeLessThanOrEqual(6);
  });
});

describe('SEC_REQUESTS_PER_SECOND in src/sec.ts', () => {
  function loadSecWith(value: string | undefined): typeof import('../sec') {
    const saved = process.env.SEC_REQUESTS_PER_SECOND;
    if (value === undefined) delete process.env.SEC_REQUESTS_PER_SECOND;
    else process.env.SEC_REQUESTS_PER_SECOND = value;
    try {
      let mod: typeof import('../sec') | undefined;
      jest.isolateModules(() => {
        mod = jest.requireActual<typeof import('../sec')>('../sec');
      });
      return mod!;
    } finally {
      if (saved === undefined) delete process.env.SEC_REQUESTS_PER_SECOND;
      else process.env.SEC_REQUESTS_PER_SECOND = saved;
    }
  }

  test('uses the configured share', () => {
    expect(loadSecWith('2').SEC_REQUESTS_PER_SECOND).toBe(2);
  });

  test('falls back to 7 for a process run on its own', () => {
    expect(loadSecWith(undefined).SEC_REQUESTS_PER_SECOND).toBe(7);
  });

  test('refuses a share above 8 rather than silently using it', () => {
    expect(() => loadSecWith('10')).toThrow('SEC_REQUESTS_PER_SECOND must be greater than 0 and at most 8');
  });
});
