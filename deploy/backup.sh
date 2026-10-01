#!/usr/bin/env bash
# Nightly logical backup with retention. Run from the deploy directory (the systemd unit does).
# Restore:  gunzip -c backups/borga-YYYYmmdd-HHMMSS.sql.gz | docker compose exec -T db sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" borga'
set -euo pipefail
cd "$(dirname "$0")"
KEEP_DAYS="${KEEP_DAYS:-14}"
mkdir -p backups
out="backups/borga-$(date +%Y%m%d-%H%M%S).sql.gz"
docker compose exec -T db sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --databases borga' | gzip > "$out"
# A tiny file means the dump failed silently: fail loudly instead of rotating good backups away.
[ "$(stat -c %s "$out")" -gt 500 ] || { echo "backup suspiciously small: $out" >&2; rm -f "$out"; exit 1; }
find backups -name 'borga-*.sql.gz' -mtime +"$KEEP_DAYS" -delete
echo "ok $out"
