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
/**
 * Variables a service runs fine without, but which must be well-formed when
 * set. READ_DATABASE_URL (Phase 7, step 2) is the read replica: unset, reads
 * simply go to the primary. A malformed one would not crash anything either -
 * src/db.ts falls back to the primary for every failed replica read - which is
 * exactly why it is checked here: otherwise a typo would silently disable the
 * replica, visible only as a warning on every request.
 */
export type OptionalEnvVar = 'READ_DATABASE_URL' | 'CACHE_REDIS_URL';
export type EnvVar = RequiredEnvVar | OptionalEnvVar;
export type ServiceName = 'api' | 'parser-worker' | 'scoring-worker' | 'notification-worker';

const REDIS_URL_FORMAT = z.string().regex(/^rediss?:\/\/\S+$/, 'must be a redis:// or rediss:// URL');
const POSTGRES_URL = z.string().regex(/^postgres(ql)?:\/\/\S+$/, 'must be a postgres:// or postgresql:// connection URL');

/**
 * Deliberately shallow: "is this plausibly the right kind of value", not "does
 * it work". Every placeholder in .env.example must pass, because Phase 6's
 * "Done when" bar is that `docker-compose up` works with only that file
 * copied - src/__tests__/config.test.ts checks this against the real file.
 */
const FORMATS: Record<EnvVar, z.ZodType<string>> = {
  DATABASE_URL: POSTGRES_URL,
  READ_DATABASE_URL: POSTGRES_URL,
  REDIS_URL: REDIS_URL_FORMAT,
  CACHE_REDIS_URL: REDIS_URL_FORMAT,
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

/**
 * Only the API reads from the replica. The response cache (CACHE_REDIS_URL,
 * Phase 7 step 3) is used by the API, which fills it, and by the parser
 * worker, which writes new filings' facts and so must invalidate it. See
 * docker-compose.yml.
 */
export const OPTIONAL_ENV: Record<ServiceName, readonly OptionalEnvVar[]> = {
  api: ['READ_DATABASE_URL', 'CACHE_REDIS_URL'],
  'parser-worker': ['CACHE_REDIS_URL'],
  'scoring-worker': [],
  'notification-worker': [],
};

export interface EnvProblem {
  name: EnvVar;
  problem: string;
}

const NOT_SET = 'is not set';

type EnvCheck = { ok: true; value: string } | { ok: false; problem: string };

function checkEnvVar(name: EnvVar, env: NodeJS.ProcessEnv): EnvCheck {
  const value = env[name];
  // A blank value counts as missing, not as a (bad) value. That is the
  // realistic form of "missing" under this project's docker-compose.yml: for
  // a variable referenced as ${VAR} but defined nowhere, Compose only prints a
  // warning and passes an empty string into the container (confirmed with
  // `docker compose config`).
  if (value === undefined || value.trim() === '') {
    return { ok: false, problem: NOT_SET };
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
  for (const name of OPTIONAL_ENV[service]) {
    const check = checkEnvVar(name, env);
    // Unset is a valid state for an optional variable; only a bad value is a problem.
    if (!check.ok && check.problem !== NOT_SET) {
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
    `[${service}] Refusing to start - ${problems.length} environment variable(s) missing or invalid:`,
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

/** `undefined` when unset or blank; throws like requireEnv when set to a malformed value. */
export function optionalEnv(name: OptionalEnvVar, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const check = checkEnvVar(name, env);
  if (check.ok) {
    return check.value;
  }
  if (check.problem === NOT_SET) {
    return undefined;
  }
  throw new Error(`${name} ${check.problem}. Fix it, or leave it unset to disable it (see .env.example).`);
}
