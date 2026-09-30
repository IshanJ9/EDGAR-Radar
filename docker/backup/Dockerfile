# The nightly backup job (docker/backup/backup.sh): the same Postgres image as
# the database, so pg_dump matches the server's major version, plus curl for
# the upload - Oracle Object Storage needs an HTTP PUT, which busybox wget
# cannot send.
FROM postgres:16-alpine
RUN apk add --no-cache curl
COPY backup.sh /usr/local/bin/backup.sh
RUN chmod +x /usr/local/bin/backup.sh
USER postgres
ENTRYPOINT ["/usr/local/bin/backup.sh"]
