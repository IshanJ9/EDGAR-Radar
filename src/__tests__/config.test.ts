/**
 * Unit tests for src/config.ts - Phase 6 failure case "a container missing a
 * required env var fails fast with a clear error."
 *
 * Every function under test takes the environment as a parameter, so nothing
 * here touches the real process.env. `exitIfEnvInvalid` itself is not called:
 * it is a thin wrapper that writes `formatEnvProblems` to stderr and exits,
 * and its real-world behaviour - the exit code, the timing, and the message as
 * it appears in `docker logs` - is verified against real containers instead
 * (see PROGRESS.md), which a mocked process.exit could not demonstrate.
 */
import { readFileSync } from 'fs';
import * as path from 'path';
import { parse } from 'dotenv';
import { findEnvProblems, formatEnvProblems, optionalEnv, requireEnv, REQUIRED_ENV, ServiceName } from '../config';

const SERVICES = Object.keys(REQUIRED_ENV) as ServiceName[];
const WORKERS: ServiceName[] = ['parser-worker', 'scoring-worker', 'notification-worker'];

const VALID: Record<string, string> = {
  DATABASE_URL: 'postgresql://postgres:postgres@postgres:5432/edgar_radar',
  REDIS_URL: 'redis://redis:6379',
  EDGAR_CONTACT_EMAIL: 'contact@example.com',
  JWT_SECRET: 'a-long-random-test-secret',
};

function without(name: string): Record<string, string> {
  const env = { ...VALID };
  delete env[name];
  return env;
}

describe('findEnvProblems', () => {
  test.each(SERVICES)('%s accepts a complete, well-formed environment', (service) => {
    expect(findEnvProblems(service, VALID)).toEqual([]);
  });

  // Parsed from the real file on purpose, not copied into this test: Phase 6's
  // "Done when" bar is that `docker-compose up` works with only .env.example
  // copied, so validation must never reject its placeholder values. If
  // someone later edits .env.example into a shape the rules reject, this
  // fails instead of every fresh checkout.
  test.each(SERVICES)('%s accepts the placeholder values in .env.example', (service) => {
    const envExample = parse(readFileSync(path.join(__dirname, '..', '..', '.env.example')));
    expect(findEnvProblems(service, envExample)).toEqual([]);
  });

  test.each(REQUIRED_ENV.api)('the API reports %s as not set when it is absent', (name) => {
    expect(findEnvProblems('api', without(name))).toEqual([{ name, problem: 'is not set' }]);
  });

  test.each(['', '   '])('treats a blank value (%j) as not set - what docker compose passes for an undefined variable', (blank) => {
    expect(findEnvProblems('api', { ...VALID, JWT_SECRET: blank })).toEqual([{ name: 'JWT_SECRET', problem: 'is not set' }]);
  });

  test('reports every problem in one pass instead of stopping at the first', () => {
    expect(findEnvProblems('api', {}).map((p) => p.name)).toEqual([
      'DATABASE_URL',
      'REDIS_URL',
      'EDGAR_CONTACT_EMAIL',
      'JWT_SECRET',
    ]);
  });

  test('rejects values of the wrong shape, not only missing ones', () => {
    const problems = findEnvProblems('api', {
      ...VALID,
      DATABASE_URL: 'mysql://root@db:3306/edgar_radar',
      REDIS_URL: 'localhost:6379',
      EDGAR_CONTACT_EMAIL: 'not-an-email',
    });
    expect(problems.map((p) => p.name)).toEqual(['DATABASE_URL', 'REDIS_URL', 'EDGAR_CONTACT_EMAIL']);
    expect(problems.every((p) => p.problem !== 'is not set')).toBe(true);
  });

  test.each(WORKERS)('%s does not require JWT_SECRET', (service) => {
    expect(findEnvProblems(service, without('JWT_SECRET'))).toEqual([]);
  });
});

describe('formatEnvProblems', () => {
  test('names the service, the count and every variable, without echoing any value', () => {
    const env = { ...VALID, JWT_SECRET: '', REDIS_URL: 'localhost:6379' };
    const message = formatEnvProblems('api', findEnvProblems('api', env));
    expect(message).toContain('[api]');
    expect(message).toContain('2 environment variable(s)');
    expect(message).toContain('JWT_SECRET is not set');
    expect(message).toContain('REDIS_URL must be a redis://');
    expect(message).not.toContain('localhost:6379');
  });
});

describe('requireEnv', () => {
  test('returns the value when it is present and well-formed', () => {
    expect(requireEnv('REDIS_URL', VALID)).toBe('redis://redis:6379');
  });

  test('throws an error naming the variable when it is missing', () => {
    expect(() => requireEnv('DATABASE_URL', {})).toThrow('DATABASE_URL is not set');
  });

  test('throws when the value is malformed, without including the value', () => {
    expect(() => requireEnv('REDIS_URL', { REDIS_URL: 'localhost:6379' })).toThrow('REDIS_URL must be a redis://');
    expect(() => requireEnv('REDIS_URL', { REDIS_URL: 'localhost:6379' })).not.toThrow('localhost:6379');
  });
});

// Phase 7, step 2: READ_DATABASE_URL is optional - unset means "no replica,
// read from the primary" - but a malformed value is refused at startup rather
// than silently disabling the replica (see src/config.ts).
describe('READ_DATABASE_URL (optional)', () => {
  test.each([undefined, '', '   '])('the API starts without a replica (value %j)', (value) => {
    const env = value === undefined ? VALID : { ...VALID, READ_DATABASE_URL: value };
    expect(findEnvProblems('api', env)).toEqual([]);
  });

  test('the API accepts a well-formed replica URL', () => {
    const env = { ...VALID, READ_DATABASE_URL: 'postgresql://postgres:postgres@postgres-replica:5432/edgar_radar' };
    expect(findEnvProblems('api', env)).toEqual([]);
  });

  test('the API refuses a malformed replica URL, without echoing it', () => {
    const env = { ...VALID, READ_DATABASE_URL: 'postgres-replica:5432' };
    const problems = findEnvProblems('api', env);
    expect(problems).toEqual([{ name: 'READ_DATABASE_URL', problem: expect.stringContaining('must be a postgres://') }]);
    expect(formatEnvProblems('api', problems)).not.toContain('postgres-replica:5432');
  });

  test.each(WORKERS)('%s ignores it - only the API reads from the replica', (service) => {
    expect(findEnvProblems(service, { ...VALID, READ_DATABASE_URL: 'garbage' })).toEqual([]);
  });

  test('optionalEnv returns undefined when unset or blank, and the value when well-formed', () => {
    expect(optionalEnv('READ_DATABASE_URL', {})).toBeUndefined();
    expect(optionalEnv('READ_DATABASE_URL', { READ_DATABASE_URL: ' ' })).toBeUndefined();
    expect(optionalEnv('READ_DATABASE_URL', { READ_DATABASE_URL: 'postgres://r:5432/db' })).toBe('postgres://r:5432/db');
  });

  test('optionalEnv throws on a malformed value, naming the variable but not the value', () => {
    expect(() => optionalEnv('READ_DATABASE_URL', { READ_DATABASE_URL: 'replica:5432' })).toThrow('READ_DATABASE_URL must be a postgres://');
    expect(() => optionalEnv('READ_DATABASE_URL', { READ_DATABASE_URL: 'replica:5432' })).not.toThrow('replica:5432');
  });
});

// Phase 7, step 3: CACHE_REDIS_URL is optional - unset means "no response
// cache" - and only the two services that use the cache check it.
describe('CACHE_REDIS_URL (optional)', () => {
  const CACHE_USERS: ServiceName[] = ['api', 'parser-worker'];

  test.each(CACHE_USERS)('%s starts without a cache', (service) => {
    expect(findEnvProblems(service, VALID)).toEqual([]);
    expect(findEnvProblems(service, { ...VALID, CACHE_REDIS_URL: '' })).toEqual([]);
  });

  test.each(CACHE_USERS)('%s accepts a well-formed cache URL', (service) => {
    expect(findEnvProblems(service, { ...VALID, CACHE_REDIS_URL: 'redis://redis-cache:6379' })).toEqual([]);
  });

  test.each(CACHE_USERS)('%s refuses a malformed cache URL', (service) => {
    expect(findEnvProblems(service, { ...VALID, CACHE_REDIS_URL: 'redis-cache:6379' })).toEqual([
      { name: 'CACHE_REDIS_URL', problem: expect.stringContaining('must be a redis://') },
    ]);
  });

  test.each(['scoring-worker', 'notification-worker'] as ServiceName[])('%s ignores it - it neither reads nor writes cached data', (service) => {
    expect(findEnvProblems(service, { ...VALID, CACHE_REDIS_URL: 'garbage' })).toEqual([]);
  });
});

// Post-Phase 7, step 1: SEC_REQUESTS_PER_SECOND - a process's share of SEC's
// 10 requests/second (src/sec.ts). Optional; checked for the two services
// that call SEC.
describe('SEC_REQUESTS_PER_SECOND (optional)', () => {
  test.each(['1', '2', '2.5', '8'])('accepts %s', (value) => {
    expect(findEnvProblems('api', { ...VALID, SEC_REQUESTS_PER_SECOND: value })).toEqual([]);
    expect(findEnvProblems('parser-worker', { ...VALID, SEC_REQUESTS_PER_SECOND: value })).toEqual([]);
  });

  test.each(['0', '8.5', '10', '-1', 'two', '1e3'])('refuses %s', (value) => {
    expect(findEnvProblems('api', { ...VALID, SEC_REQUESTS_PER_SECOND: value }).map((p) => p.name)).toEqual(['SEC_REQUESTS_PER_SECOND']);
  });

  test('unset is fine - a standalone process uses its default', () => {
    expect(findEnvProblems('api', VALID)).toEqual([]);
  });
});
