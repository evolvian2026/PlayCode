#!/usr/bin/env bash
# Back up PlayCode: a compressed dump of the database and, when files are
# stored on local disk, an archive of STORAGE_DIR (webcam snapshots, logos).
# Each backup gets a SHA-256 checksum; backups older than BACKUP_KEEP_DAYS
# are deleted. Run it daily from cron, then copy the files off the server
# (BACKUP_UPLOAD_CMD runs with the backup's file paths as arguments).
#
#   DATABASE_URL=postgres://... BACKUP_DIR=/var/backups/playcode ops/backup.sh
#
# Settings: DATABASE_URL (required), BACKUP_DIR (default ./backups),
# BACKUP_KEEP_DAYS (default 14), STORAGE_DIR (optional, local file storage),
# BACKUP_UPLOAD_CMD (optional, e.g. "aws s3 cp --recursive" wrapper script).
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

db_file="$BACKUP_DIR/playcode-$STAMP.dump"
# Custom format: compressed, and pg_restore can restore all or part of it.
pg_dump --format=custom --no-owner --no-privileges --file="$db_file.partial" "$DATABASE_URL"
mv "$db_file.partial" "$db_file"
files=("$db_file")

if [[ -n "${STORAGE_DIR:-}" && -d "$STORAGE_DIR" ]]; then
  storage_file="$BACKUP_DIR/playcode-$STAMP-storage.tar.gz"
  tar -czf "$storage_file.partial" -C "$STORAGE_DIR" .
  mv "$storage_file.partial" "$storage_file"
  files+=("$storage_file")
fi

for f in "${files[@]}"; do
  (cd "$(dirname "$f")" && sha256sum "$(basename "$f")" > "$(basename "$f").sha256")
done

# Retention: delete backups (and their checksums) older than KEEP_DAYS.
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'playcode-*' -mtime +"$KEEP_DAYS" -print -delete

if [[ -n "${BACKUP_UPLOAD_CMD:-}" ]]; then
  # shellcheck disable=SC2086
  $BACKUP_UPLOAD_CMD "${files[@]}" "${files[@]/%/.sha256}"
fi

for f in "${files[@]}"; do echo "backup: $f ($(du -h "$f" | cut -f1))"; done
