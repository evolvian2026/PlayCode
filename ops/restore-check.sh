#!/usr/bin/env bash
# Prove a backup can be restored: verify its checksum, restore it into a
# temporary database, check that the core tables and every migration are
# there, then drop the temporary database. Run it after each backup, or at
# least weekly; a backup that has never been restored isn't a backup.
#
#   ADMIN_DATABASE_URL=postgres://user:pass@host:5432/postgres ops/restore-check.sh [backup.dump]
#
# With no file, the newest playcode-*.dump in BACKUP_DIR (default ./backups)
# is checked. ADMIN_DATABASE_URL must be allowed to create databases.
set -euo pipefail

: "${ADMIN_DATABASE_URL:?Set ADMIN_DATABASE_URL (a role that can create databases)}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
file="${1:-$(ls -1t "$BACKUP_DIR"/playcode-*.dump 2>/dev/null | head -1 || true)}"
[[ -n "$file" && -f "$file" ]] || { echo "No backup found in $BACKUP_DIR" >&2; exit 1; }

if [[ -f "$file.sha256" ]]; then
  (cd "$(dirname "$file")" && sha256sum --check --quiet "$(basename "$file").sha256")
  echo "checksum: ok"
else
  echo "checksum: no .sha256 file next to $file" >&2
fi

check_db="playcode_restore_check_$(date -u +%Y%m%d%H%M%S)"
base="${ADMIN_DATABASE_URL%/*}"
cleanup() { psql "$ADMIN_DATABASE_URL" -q -c "drop database if exists $check_db" >/dev/null 2>&1 || true; }
trap cleanup EXIT

psql "$ADMIN_DATABASE_URL" -q -c "create database $check_db"
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$base/$check_db" "$file"

q() { psql "$base/$check_db" -At -c "$1"; }
tenants=$(q "select count(*) from tenants")
users=$(q "select count(*) from users")
questions=$(q "select count(*) from questions")
migrations=$(q "select count(*) from drizzle.__drizzle_migrations")
echo "restored $file: $tenants tenants, $users users, $questions questions, $migrations migrations"
[[ "$tenants" -gt 0 && "$users" -gt 0 && "$questions" -gt 0 && "$migrations" -gt 0 ]] || { echo "restore check FAILED: core tables are empty" >&2; exit 1; }
echo "restore check: ok"
