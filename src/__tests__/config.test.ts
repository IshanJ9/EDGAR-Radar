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
import { findEnvProblems, formatEnvProblems, requireEnv, REQUIRED_ENV, ServiceName } from '../config';

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
    expect(message).toContain('2 required environment variable(s)');
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
