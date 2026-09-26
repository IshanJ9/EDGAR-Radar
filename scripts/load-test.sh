#!/bin/sh
# Phase 7, step 4: load-test the API's read path in three configurations,
# on the deployed host, against its real databases.
#
#   db-only  - every read from the primary (no READ_DATABASE_URL, no cache)
#   replica  - reads from the replica (step 2), no cache
#   cache    - replica plus the Redis response cache (step 3)
#
# Run it on the host from the repository directory, with the stack up:
#     sh scripts/load-test.sh
#
# The live API is never reconfigured. Each configuration gets a temporary API
# container built from the live one's image, on Compose's internal network,
# with no published port; `autocannon` runs in another container on the same
# network. Everything is removed on exit, including the temporary env files.
#
# Only a company already stored is requested, so no request can reach SEC.
#
# Know what this measures: the load generator shares the host's CPUs with the
# API and the databases, so absolute numbers are a floor, not the server's
# ceiling. The comparison between configurations is the meaningful part.
set -eu

PROJECT="${PROJECT:-edgar-radar}"
NET="${PROJECT}_default"
IMAGE="${PROJECT}-api"
LIVE="${PROJECT}-api-1"
TARGET_PATH="${TARGET_PATH:-/companies/0000320193/facts}"
CONNECTIONS="${CONNECTIONS:-10 50}"
DURATION="${DURATION:-30}"
WARMUP="${WARMUP:-10}"
AUTOCANNON_VERSION="8.0.0"
RUNNER="lt-runner"

WORK="$(mktemp -d)"
chmod 700 "$WORK"
cleanup() {
  docker rm -f "$RUNNER" lt-api >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT INT TERM

# The live API's own environment, minus the two variables that select the
# read path - each configuration adds back only what it uses. Values stay in
# files readable only by this user and are never printed.
docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$LIVE" > "$WORK/live.env"
grep -E '^(DATABASE_URL|REDIS_URL|EDGAR_CONTACT_EMAIL|JWT_SECRET|NODE_ENV)=' "$WORK/live.env" > "$WORK/db-only.env"
cp "$WORK/db-only.env" "$WORK/replica.env"
grep '^READ_DATABASE_URL=' "$WORK/live.env" >> "$WORK/replica.env"
cp "$WORK/replica.env" "$WORK/cache.env"
grep '^CACHE_REDIS_URL=' "$WORK/live.env" >> "$WORK/cache.env"
rm -f "$WORK/live.env"

echo "Starting the load generator (autocannon ${AUTOCANNON_VERSION})..."
docker run -d --name "$RUNNER" --network "$NET" --user root --entrypoint sleep "$IMAGE" infinity >/dev/null
docker exec "$RUNNER" npm install -g --no-audit --no-fund --loglevel=error "autocannon@${AUTOCANNON_VERSION}" >/dev/null

wait_ready() {
  i=0
  until docker exec "$RUNNER" node -e "fetch('http://lt-api:3000${TARGET_PATH}').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" 2>/dev/null; do
    i=$((i + 1))
    if [ "$i" -gt 60 ]; then echo "lt-api never became ready" >&2; docker logs lt-api 2>&1 | tail -20 >&2; exit 1; fi
    sleep 1
  done
}

x_cache() {
  docker exec "$RUNNER" node -e "fetch('http://lt-api:3000${TARGET_PATH}').then(r => console.log(r.headers.get('x-cache') || '-'))"
}

summary() {
  docker exec "$RUNNER" node -e "
    const r = JSON.parse(require('fs').readFileSync('/tmp/result.json', 'utf8'));
    const l = r.latency;
    console.log([
      'req/s ' + Math.round(r.requests.average),
      'total ' + r.requests.total,
      'p50 ' + l.p50 + 'ms',
      'p97.5 ' + l.p97_5 + 'ms',
      'p99 ' + l.p99 + 'ms',
      'max ' + l.max + 'ms',
      'errors ' + r.errors,
      'timeouts ' + r.timeouts,
      'non2xx ' + r.non2xx,
    ].join(' | '));
  "
}

for config in db-only replica cache; do
  echo
  echo "=== ${config} ==="
  docker run -d --name lt-api --network "$NET" --env-file "$WORK/${config}.env" "$IMAGE" >/dev/null
  wait_ready
  echo "X-Cache on a sample request: $(x_cache)"
  for c in $CONNECTIONS; do
    # Warm-up, discarded: JIT, connection pools, and (for `cache`) the entry.
    docker exec "$RUNNER" autocannon -c "$c" -d "$WARMUP" --json "http://lt-api:3000${TARGET_PATH}" >/dev/null 2>&1
    # One CPU snapshot halfway through the measured run.
    (sleep $((DURATION / 2)); docker stats --no-stream --format '    {{.Name}} {{.CPUPerc}}' lt-api "${PROJECT}-postgres-1" "${PROJECT}-postgres-replica-1" "${PROJECT}-redis-cache-1" "$RUNNER" > "$WORK/stats.txt") &
    docker exec "$RUNNER" sh -c "autocannon -c $c -d $DURATION --json 'http://lt-api:3000${TARGET_PATH}' > /tmp/result.json 2>/dev/null"
    wait
    echo "  ${c} connections: $(summary)"
    echo "  CPU at mid-run:"
    cat "$WORK/stats.txt"
  done
  docker rm -f lt-api >/dev/null
done
