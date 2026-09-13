import { writeSync } from 'fs';
import { z } from 'zod';

/**
 * Required-environment validation - Phase 6 failure case: "a container
 * missing a required env var fails fast with a clear error."
 *
 * Built after testing the behaviour for real rather than assuming it: 17
 * containers from the production image, each with exactly one required
 * variable unset (see PROGRESS.md). Only EDGAR_CONTACT_EMAIL and JWT_SECRET
 * failed fast, because their modules threw at import. A missing DATABASE_URL
 * was invisible - every service logged exactly what a healthy one logs,
 * because `pg` quietly falls back to localhost and only connects on the first
 * query. A missing REDIS_URL kept every service running while BullMQ logged
 * `connect ECONNREFUSED 127.0.0.1:6379` 193 times in 6 seconds without ever
 * naming the variable.
 *
 * Two ways in, one set of rules:
 * - `exitIfEnvInvalid(service)` - called by each container entrypoint's
 *   bootstrap module (src/bootstrap/) before anything else loads. Reports
 *   every problem at once and exits 1.
 * - `requireEnv(name)` - used where a value is actually read (db.ts, sec.ts,
 *   queues.ts, the auth modules, the worker entrypoints). It also covers the
 *   scripts that have no bootstrap module (backfill, poller, reconciliation)
 *   with the same rules and wording.
 */

export type RequiredEnvVar = 'DATABASE_URL' | 'REDIS_URL' | 'EDGAR_CONTACT_EMAIL' | 'JWT_SECRET';
export type ServiceName = 'api' | 'parser-worker' | 'scoring-worker' | 'notification-worker';

/**
 * Deliberately shallow: "is this plausibly the right kind of value", not "does
 * it work". Every placeholder in .env.example must pass, because Phase 6's
 * "Done when" bar is that `docker-compose up` works with only that file
 * copied - src/__tests__/config.test.ts checks this against the real file.
 */
const FORMATS: Record<RequiredEnvVar, z.ZodType<string>> = {
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\/\S+$/, 'must be a postgres:// or postgresql:// connection URL'),
  REDIS_URL: z.string().regex(/^rediss?:\/\/\S+$/, 'must be a redis:// or rediss:// URL'),
  EDGAR_CONTACT_EMAIL: z.email('must be a valid email address - SEC requires a real contact email on every request'),
  JWT_SECRET: z.string(),
};

/**
 * What each container genuinely cannot start without - taken from what the
 * code loads at import time, and confirmed by the 17-container test:
 * - The API needs REDIS_URL even with Bull Board switched off: app.ts imports
 *   bullBoard.ts, which imports queues.ts, which opens its queue connections
 *   at import time.
 * - The scoring and notification workers never call SEC, but they reach
 *   src/sec.ts through transitive imports, so they need EDGAR_CONTACT_EMAIL
 *   too. Both exited immediately without it in that test.
 * - None of the workers use JWT_SECRET.
 */
export const REQUIRED_ENV: Record<ServiceName, readonly RequiredEnvVar[]> = {
  api: ['DATABASE_URL', 'REDIS_URL', 'EDGAR_CONTACT_EMAIL', 'JWT_SECRET'],
  'parser-worker': ['DATABASE_URL', 'REDIS_URL', 'EDGAR_CONTACT_EMAIL'],
  'scoring-worker': ['DATABASE_URL', 'REDIS_URL', 'EDGAR_CONTACT_EMAIL'],
  'notification-worker': ['DATABASE_URL', 'REDIS_URL', 'EDGAR_CONTACT_EMAIL'],
};

export interface EnvProblem {
  name: RequiredEnvVar;
  problem: string;
}

type EnvCheck = { ok: true; value: string } | { ok: false; problem: string };

function checkEnvVar(name: RequiredEnvVar, env: NodeJS.ProcessEnv): EnvCheck {
  const value = env[name];
  // A blank value counts as missing, not as a (bad) value. That is the
  // realistic form of "missing" under this project's docker-compose.yml: for
  // a variable referenced as ${VAR} but defined nowhere, Compose only prints a
  // warning and passes an empty string into the container (confirmed with
  // `docker compose config`).
  if (value === undefined || value.trim() === '') {
    return { ok: false, problem: 'is not set' };
  }
  const result = FORMATS[name].safeParse(value);
  if (!result.success) {
    return { ok: false, problem: result.error.issues[0]?.message ?? 'has an invalid value' };
  }
  return { ok: true, value };
}

export function findEnvProblems(service: ServiceName, env: NodeJS.ProcessEnv = process.env): EnvProblem[] {
  const problems: EnvProblem[] = [];
  for (const name of REQUIRED_ENV[service]) {
    const check = checkEnvVar(name, env);
    if (!check.ok) {
      problems.push({ name, problem: check.problem });
    }
  }
  return problems;
}

/**
 * Names variables, never their values - a malformed JWT_SECRET or a
 * DATABASE_URL with a password in it must not end up in container logs just
 * because it failed validation.
 */
export function formatEnvProblems(service: ServiceName, problems: readonly EnvProblem[]): string {
  return [
    `[${service}] Refusing to start - ${problems.length} required environment variable(s) missing or invalid:`,
    ...problems.map((p) => `  - ${p.name} ${p.problem}`),
    "Set them in this container's environment. Under docker compose they are passed in by docker-compose.yml from .env; see .env.example for every variable.",
  ].join('\n');
}

export function exitIfEnvInvalid(service: ServiceName): void {
  const problems = findEnvProblems(service);
  if (problems.length === 0) {
    return;
  }
  // Written synchronously to stderr rather than through the pino logger. In
  // development the logger writes via pino-pretty's worker-thread transport,
  // and a process.exit() immediately afterwards can drop that line - which is
  // the one message this function exists to deliver. writeSync cannot be lost
  // that way, on any platform.
  writeSync(2, `${formatEnvProblems(service, problems)}\n`);
  process.exit(1);
}

export function requireEnv(name: RequiredEnvVar, env: NodeJS.ProcessEnv = process.env): string {
  const check = checkEnvVar(name, env);
  if (!check.ok) {
    throw new Error(`${name} ${check.problem}. Set it in the environment (see .env.example).`);
  }
  return check.value;
}
