#!/usr/bin/env bash
# scripts/restore-db.sh — load a backup produced by backup-db.sh into a target
# DB. INTERACTIVE by default (asks before dropping data) because this is the
# emergency-recovery path, not a routine job.
#
# Usage:
#   DATABASE_URL=postgres://... ./scripts/restore-db.sh path/to/backup.sql.gz
#   FORCE=1 DATABASE_URL=... ./scripts/restore-db.sh path/to/backup.sql.gz  (skip prompt)
#
# The dump was produced with --clean --if-exists, so DROP TABLE statements are
# embedded — restoring into an existing DB will replace its tables. Restore
# into a fresh DB (`CREATE DATABASE msecretary_restore`) when possible.
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"

if [[ $# -lt 1 ]]; then
  echo "usage: DATABASE_URL=... $0 <backup.sql.gz>" >&2
  exit 64
fi
src="$1"

if [[ ! -f "$src" ]]; then
  echo "backup file not found: $src" >&2
  exit 66
fi
if ! gunzip -t "$src" 2>/dev/null; then
  echo "backup file is not a valid gzip: $src" >&2
  exit 65
fi

# Mask the password in confirmation prompt so it doesn't end up in terminal scrollback.
masked=$(printf '%s' "$DATABASE_URL" | sed -E 's#(://[^:]+:)[^@]+(@)#\1***\2#')

if [[ "${FORCE:-0}" != "1" ]]; then
  echo "About to restore $src into:"
  echo "  $masked"
  echo "Existing data in the target DB will be DROPPED (the dump uses --clean --if-exists)."
  read -r -p "Type 'yes' to proceed: " ans
  [[ "$ans" == "yes" ]] || { echo "aborted"; exit 1; }
fi

echo "[restore-db] streaming $src → target"
gunzip -c "$src" | psql --quiet --set ON_ERROR_STOP=1 "$DATABASE_URL"
echo "[restore-db] done"
