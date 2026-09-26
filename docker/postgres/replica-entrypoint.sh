#!/bin/sh
# Entrypoint for the `postgres-replica` service (Phase 7, step 2): a hot
# standby that streams WAL from the `postgres` primary and serves read-only
# queries.
#
# On first start (empty data volume) it clones the primary with
# pg_basebackup, which with -R also writes standby.signal and primary_conninfo
# so the server comes up as a standby. On every later start the data
# directory already exists and this just hands over to the image's normal
# entrypoint, which resumes streaming from where it left off.
#
# Runs as root (the image default) so it can prepare the data directory; the
# clone itself runs as `postgres` via su-exec, so every file it writes has the
# ownership the server needs.
set -eu

PGDATA="${PGDATA:-/var/lib/postgresql/data}"
SLOT="edgar_replica_slot"

if [ ! -s "$PGDATA/PG_VERSION" ]; then
  echo "[replica] Data directory is empty - cloning from primary '${PRIMARY_HOST}'"
  export PGPASSWORD="$POSTGRES_PASSWORD"

  until pg_isready -q -h "$PRIMARY_HOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB"; do
    echo "[replica] Waiting for the primary to accept connections..."
    sleep 2
  done

  # The physical replication slot makes the primary keep WAL until this
  # replica has received it, so a replica that is briefly down can catch up
  # instead of needing a full re-clone. Both statements are idempotent, because
  # a replica rebuilt from an empty volume finds its old slot still on the
  # primary:
  # - a slot the primary has invalidated (it passed max_slot_wal_keep_size -
  #   see docker-compose.yml) can never be streamed from again, so it is
  #   dropped and recreated;
  # - otherwise an existing slot is reused rather than failing on "already
  #   exists".
  psql -h "$PRIMARY_HOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -qtA <<SQL
SELECT pg_drop_replication_slot(slot_name) FROM pg_replication_slots
 WHERE slot_name = '${SLOT}' AND wal_status = 'lost' AND NOT active;
SELECT pg_create_physical_replication_slot('${SLOT}')
 WHERE NOT EXISTS (SELECT 1 FROM pg_replication_slots WHERE slot_name = '${SLOT}');
SQL

  mkdir -p "$PGDATA"
  chown postgres:postgres "$PGDATA"
  chmod 700 "$PGDATA"

  # -X stream: copy the WAL generated during the backup too, so the clone is
  # consistent on its own. -R: write the standby configuration.
  su-exec postgres pg_basebackup \
    -h "$PRIMARY_HOST" -U "$POSTGRES_USER" -D "$PGDATA" \
    -X stream -S "$SLOT" -R --verbose
  echo "[replica] Clone complete - starting as a hot standby"
fi

exec docker-entrypoint.sh postgres
