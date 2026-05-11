#!/usr/bin/env bash
# scripts/backup-minio.sh — mirror the msecretary bucket to an off-host
# S3-compatible bucket using the official `mc` (MinIO Client) CLI.
#
# Why a separate script from pg_dump: the bucket grows unboundedly (every
# uploaded chunk + every export) and pg_dump backups are tiny by comparison.
# Don't pipe binary blob data through SQL — keep them in object storage and
# replicate at that layer.
#
# Required env:
#   SRC_ALIAS         mc alias name for source (e.g. "local") — already
#                     configured via `mc alias set local http://minio:9000 ...`
#   DST_ALIAS         mc alias name for destination (e.g. "offsite")
#   SRC_BUCKET        default msecretary
#   DST_BUCKET        required — name of the off-host backup bucket
# Optional:
#   PRESERVE_DELETES  if "1", do NOT propagate deletions (treat dst as
#                     append-only archive). Default: "1" — safer for backups.
#
# One-time setup on the backup host:
#   mc alias set local    http://minio:9000             $MINIO_ROOT_USER $MINIO_ROOT_PASSWORD
#   mc alias set offsite  https://your-backup-host.r2/  $OFFSITE_KEY     $OFFSITE_SECRET
#
# Cron example (every 4 hours):
#   0 */4 * * *  SRC_ALIAS=local DST_ALIAS=offsite DST_BUCKET=msec-backup /opt/m-secretary/scripts/backup-minio.sh
set -euo pipefail

: "${SRC_ALIAS:?SRC_ALIAS is required}"
: "${DST_ALIAS:?DST_ALIAS is required}"
: "${DST_BUCKET:?DST_BUCKET is required}"
SRC_BUCKET="${SRC_BUCKET:-msecretary}"
PRESERVE_DELETES="${PRESERVE_DELETES:-1}"

# --watch is for daemon mode; we want a one-shot run from cron.
# --overwrite handles re-uploaded chunks (same key, different bytes after
# re-encoding) by replacing on the destination.
mirror_args=(--quiet --overwrite)

# By default DON'T remove files from the destination if they're missing from
# the source. Append-only backups protect against an attacker (or a bug)
# deleting prod data — the off-host copy retains the older state until you
# manually prune.
if [[ "$PRESERVE_DELETES" != "1" ]]; then
  mirror_args+=(--remove)
fi

echo "[backup-minio] $SRC_ALIAS/$SRC_BUCKET → $DST_ALIAS/$DST_BUCKET (preserve_deletes=$PRESERVE_DELETES)"
mc mirror "${mirror_args[@]}" "$SRC_ALIAS/$SRC_BUCKET" "$DST_ALIAS/$DST_BUCKET"
echo "[backup-minio] done"
