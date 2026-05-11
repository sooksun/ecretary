#!/usr/bin/env bash
# scripts/backup-db.sh — pg_dump of the prod database with 7-day retention.
#
# Designed to be cron-safe (no terminal interaction, non-zero exit on failure
# so cron emails the user). Output filenames include UTC timestamp so the
# retention sweep can identify oldest backups deterministically.
#
# Required env (typically set in the cron line or a wrapper):
#   DATABASE_URL          postgres://user:pass@host:5432/db?... (read-only role OK)
#   BACKUP_DIR            absolute path to a directory the script can write to
# Optional:
#   BACKUP_RETENTION_DAYS default 7
#   BACKUP_PREFIX         default msecretary (used in filename)
#
# Cron example (daily 02:15 server time):
#   15 2 * * *  DATABASE_URL=... BACKUP_DIR=/var/backups/msec /opt/m-secretary/scripts/backup-db.sh
#
# Restore: see scripts/restore-db.sh
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_DIR:?BACKUP_DIR is required (e.g. /var/backups/msec)}"
RETENTION="${BACKUP_RETENTION_DAYS:-7}"
PREFIX="${BACKUP_PREFIX:-msecretary}"

mkdir -p "$BACKUP_DIR"

ts=$(date -u +"%Y%m%dT%H%M%SZ")
out="$BACKUP_DIR/${PREFIX}-${ts}.sql.gz"
tmp="$out.partial"

# --no-owner / --no-acl: dumps restore cleanly into a different role/cluster.
# -Fc gives custom format (smaller, parallel-restore-capable), but plain SQL
# stays grep-able for ad-hoc inspection — we use plain + gzip here for clarity.
echo "[backup-db] dumping → $out"
if ! pg_dump --no-owner --no-acl --clean --if-exists "$DATABASE_URL" | gzip -c > "$tmp"; then
  echo "[backup-db] FAIL pg_dump exited non-zero" >&2
  rm -f "$tmp"
  exit 1
fi
mv "$tmp" "$out"

# Integrity check — gunzip refuses to silently emit truncated output.
if ! gunzip -t "$out" 2>/dev/null; then
  echo "[backup-db] FAIL backup file is not a valid gzip: $out" >&2
  rm -f "$out"
  exit 1
fi

size=$(wc -c < "$out")
echo "[backup-db] ok bytes=$size"

# Retention sweep — keep the N newest, delete the rest. Use mtime not filename
# parse so a malformed filename can't accidentally protect the wrong file.
find "$BACKUP_DIR" -maxdepth 1 -type f -name "${PREFIX}-*.sql.gz" -printf '%T@ %p\n' \
  | sort -nr \
  | awk -v keep="$RETENTION" 'NR>keep { sub(/^[^ ]+ /,""); print }' \
  | while IFS= read -r old; do
      echo "[backup-db] pruning $old"
      rm -f "$old"
    done

echo "[backup-db] done"
