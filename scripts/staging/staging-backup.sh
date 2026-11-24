#!/usr/bin/env bash
# Backs up the running staging stack as one matched set: the Roviq and Temporal databases, the
# database roles, the object store and a manifest of the release. The apps are stopped during the
# copy so the databases and the files agree, then started again.
#
# Usage: STAGING_ENV_FILE=<env file> scripts/staging/staging-backup.sh [--keep-stopped]
# Prints the backup folder on its last line. Backups older than STAGING_BACKUP_KEEP_DAYS
# (default 7) are removed.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=staging-lib.sh
. "$SCRIPT_DIR/staging-lib.sh"

KEEP_STOPPED=false
[[ "${1:-}" == "--keep-stopped" ]] && KEEP_STOPPED=true

SHA="$(current_release || true)"
if [[ -z "$SHA" ]]; then
    log "No release is deployed; nothing to back up."
    exit 0
fi
REL="$RELEASES_DIR/$SHA"

if [[ -z "$(stg_compose "$REL" ps -q postgres)" ]]; then
    log "The database is not running; nothing to back up."
    exit 0
fi

OUT="$BACKUPS_DIR/$(date -u +%Y%m%dT%H%M%SZ)-$SHA"
mkdir -p "$OUT"
chmod 700 "$OUT"

log "Stopping the apps for a consistent copy"
stg_compose "$REL" stop "${APP_SERVICES[@]}"

restart_apps() {
    if [[ "$KEEP_STOPPED" == false ]]; then
        log "Starting the apps again"
        stg_compose "$REL" start "${APP_SERVICES[@]}"
    fi
}
trap restart_apps EXIT

for db in roviq temporal temporal_visibility; do
    log "Dumping database $db"
    stg_compose "$REL" exec -T postgres pg_dump -U roviq -Fc "$db" >"$OUT/$db.dump"
done
log "Dumping database roles"
stg_compose "$REL" exec -T postgres pg_dumpall -U roviq --roles-only >"$OUT/roles.sql"

log "Copying the object store"
docker run --rm \
    -v "${STAGING_PROJECT}_roviq-objects:/data:ro" \
    -v "$OUT:/out" \
    postgres:18-alpine tar -C /data -czf /out/objects.tar.gz .

{
    echo "release=$SHA"
    echo "created=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    for image in migrator api-gateway notification-service web; do
        echo "image.$image=$(docker image inspect --format '{{.Id}}' "$STAGING_IMAGE_PREFIX/$image:$SHA")"
    done
} >"$OUT/manifest"
chmod 600 "$OUT"/*

KEEP_DAYS="${STAGING_BACKUP_KEEP_DAYS:-7}"
find "$BACKUPS_DIR" -mindepth 1 -maxdepth 1 -type d -mtime +"$KEEP_DAYS" -print -exec rm -r {} +

log "Backup complete"
echo "$OUT"
