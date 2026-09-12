import pino from 'pino';

/**
 * One shared, structured logger for the 4 composed services (API, parser
 * worker, scoring worker, notification worker - see docker-compose.yml).
 *
 * JSON lines in production - what a real log aggregator (CloudWatch, etc.)
 * expects, and what Phase 6/7's AWS move needs - versus pretty-printed,
 * colorized output in development via `pino-pretty`. `pino-pretty` is a
 * devDependency only, deliberately never installed in the production
 * runtime image (`npm ci --omit=dev` in the Dockerfile's `runtime` stage),
 * so `transport` must never be configured when `NODE_ENV === 'production'` -
 * doing so would crash the container trying to load a module that isn't
 * there.
 *
 * `err` is listed under `serializers` explicitly even though pino v10
 * already serializes an `err`-keyed Error by default (verified directly
 * before writing this - a plain `JSON.stringify(new Error(...))` produces
 * `{}`, since `message`/`stack` are non-enumerable, which is exactly the
 * kind of silent, useless log line structured logging is meant to prevent).
 * Kept explicit rather than relying on the default so this can't silently
 * regress if a future pino major version changes it.
 */
// Built via a conditional spread, not `transport: isProd ? x : undefined` -
// this project's tsconfig sets `exactOptionalPropertyTypes: true`, under
// which explicitly assigning `undefined` to an optional property is a type
// error distinct from omitting the property entirely (caught by `tsc`
// before this was ever run) - and omitting it is also what actually matters
// here: an explicit `undefined` and a genuinely absent key behave the same
// at runtime, but only the latter type-checks under this config.
const isProduction = process.env.NODE_ENV === 'production';
// `|| 'info'`, not `?? 'info'`: this project's own .env.example convention
// (matching ALERT_SLACK_WEBHOOK_URL=) leaves optional vars present but
// empty, not absent, in a freshly-copied .env. `??` only falls back on
// null/undefined, so an empty string would pass straight through to pino
// as `level: ''` - confirmed directly that this throws at construction time
// ("default level: must be included in custom levels"), which would have
// crashed every one of the 4 composed services on startup with nothing
// more than a clean `.env.example` copy and zero edits.
const baseLogger = pino({
  level: process.env.LOG_LEVEL || 'info',
  serializers: { err: pino.stdSerializers.err },
  ...(isProduction
    ? {}
    : { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }),
});

/**
 * Returns a child logger tagged with `service` - once the 4 composed
 * services run as separate containers whose logs get aggregated together,
 * knowing which service emitted a given line is the first thing a reader
 * needs, and a child logger (not a fresh `pino()` call per service) shares
 * the same underlying transport/level/serializer configuration rather than
 * risking 4 independently-drifting logger setups.
 */
export function createLogger(service: string): pino.Logger {
  return baseLogger.child({ service });
}
