#!/bin/sh
# Nightly off-box backup of the primary Postgres (post-Phase 7 hardening, step 1).
#
# Once a day at BACKUP_HOUR_UTC (default 03:00, after the 02:00 reconciliation),
# takes a compressed pg_dump, checks that pg_restore can read it, and uploads it
# with an HTTP PUT to BACKUP_UPLOAD_URL - an Oracle Object Storage
# pre-authenticated request that can only write objects: it cannot read, list or
# delete them, so a compromised host cannot pull earlier backups back out.
#
# Objects are named by day of the month (edgar_radar-01.dump ... -31.dump), so
# each night overwrites the one from a month earlier and about a month of
# history is kept without ever deleting anything.
#
# BACKUP_UPLOAD_URL is a secret (anyone holding it can write to the bucket), so
# it is never printed. `backup.sh once` takes a single backup and exits.

HOUR="${BACKUP_HOUR_UTC:-3}"
DUMP=/tmp/edgar_radar.dump

log() { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*"; }

backup_once() {
  if [ -z "${BACKUP_UPLOAD_URL:-}" ]; then
    log "Backup SKIPPED: BACKUP_UPLOAD_URL is not set."
    return 1
  fi
  name="edgar_radar-$(date -u +%d).dump"
  rm -f "$DUMP"
  if ! pg_dump --format=custom --file="$DUMP"; then
    log "Backup FAILED: pg_dump exited non-zero."
    return 1
  fi
  if ! pg_restore --list "$DUMP" >/dev/null; then
    log "Backup FAILED: pg_restore cannot read the dump."
    return 1
  fi
  bytes=$(wc -c <"$DUMP")
  # --fail turns an HTTP error into a non-zero exit. curl's error message names
  # the status, never the URL.
  if ! curl --fail --silent --show-error --max-time 300 --retry 3 \
      --upload-file "$DUMP" "${BACKUP_UPLOAD_URL%/}/$name"; then
    log "Backup FAILED: upload of $name ($bytes bytes) was rejected."
    return 1
  fi
  log "Backup OK: $name, $bytes bytes."
}

seconds_until_next_run() {
  now=$(date -u +%s)
  target=$(date -u -d "$(date -u +%Y-%m-%d) $(printf '%02d' "$HOUR"):00:00" +%s)
  [ "$target" -le "$now" ] && target=$((target + 86400))
  echo $((target - now))
}

if [ "${1:-}" = "once" ]; then
  backup_once
  exit $?
fi

log "Backup service started: one backup a day at $(printf '%02d' "$HOUR"):00 UTC."
while true; do
  wait=$(seconds_until_next_run)
  log "Next backup in ${wait}s."
  sleep "$wait"
  # A failed night is logged and the loop carries on: exiting would only make
  # Docker restart the container, which retries nothing sooner.
  backup_once || true
done
