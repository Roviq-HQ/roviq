#!/usr/bin/env bash
# Backs up the running staging stack: the Roviq and Temporal databases, the database roles, the
# object store and a manifest of the release. Every file but the manifest is encrypted to the
# public key in STAGING_BACKUP_PUBLIC_KEY (an OpenPGP public key file); the private key is not
# needed here and is kept off this host.
#
# The apps keep running. Each database dump is one consistent snapshot of that database; the
# three dumps and the object copy are taken one after another, so they can differ by what
# changed in those seconds. With --keep-stopped the apps are stopped first and left stopped
# (the deploy does this before it migrates), and the set is exact.
#
# Usage: STAGING_ENV_FILE=<env file> scripts/staging/staging-backup.sh [--keep-stopped]
# Prints the backup folder on its last line. Backups older than STAGING_BACKUP_KEEP_DAYS
# (default 7) are removed. Copy the folder off the host afterwards (docs/deployment.md →
# "Staging").
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

: "${STAGING_BACKUP_PUBLIC_KEY:?STAGING_BACKUP_PUBLIC_KEY must name the OpenPGP public key file backups are encrypted to}"
[[ -r "$STAGING_BACKUP_PUBLIC_KEY" ]] || { echo "Cannot read $STAGING_BACKUP_PUBLIC_KEY" >&2; exit 1; }
command -v gpg >/dev/null || { echo "gpg is needed to encrypt the backup" >&2; exit 1; }
# A throwaway keyring: the key file is the only key it is given.
GNUPGHOME="$(mktemp -d)"
export GNUPGHOME
trap 'rm -rf "$GNUPGHOME"' EXIT
# Encrypts stdin to the public key. The dumps are compressed already.
encrypt() {
    gpg --batch --quiet --no-tty --trust-model always --compress-algo none \
        --encrypt --recipient-file "$STAGING_BACKUP_PUBLIC_KEY" --output "$1"
}

OUT="$BACKUPS_DIR/$(date -u +%Y%m%dT%H%M%SZ)-$SHA"
mkdir -p "$OUT"
chmod 700 "$OUT"

if [[ "$KEEP_STOPPED" == true ]]; then
    log "Stopping the apps: this backup is the exact state the next release starts from"
    stg_compose "$REL" stop "${APP_SERVICES[@]}"
fi

for db in roviq temporal temporal_visibility; do
    log "Dumping database $db"
    stg_compose "$REL" exec -T postgres pg_dump -U roviq -Fc "$db" | encrypt "$OUT/$db.dump.gpg"
done
log "Dumping database roles"
stg_compose "$REL" exec -T postgres pg_dumpall -U roviq --roles-only | encrypt "$OUT/roles.sql.gpg"

if external_store; then
    # The external store keeps its own object versions and replica (docs/deployment.md).
    log "Object store is external: not copied"
else
    log "Copying the object store"
    docker run --rm -v "${STAGING_PROJECT}_roviq-objects:/data:ro" \
        postgres:18-alpine tar -C /data -czf - . | encrypt "$OUT/objects.tar.gz.gpg"
fi

{
    echo "release=$SHA"
    echo "created=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "object_store=$STAGING_OBJECT_STORE"
    echo "encrypted=openpgp"
    echo "apps_stopped=$KEEP_STOPPED"
    for image in migrator api-gateway notification-service web; do
        echo "image.$image=$(docker image inspect --format '{{.Id}}' "$STAGING_IMAGE_PREFIX/$image:$SHA")"
    done
} >"$OUT/manifest"
chmod 600 "$OUT"/*

KEEP_DAYS="${STAGING_BACKUP_KEEP_DAYS:-7}"
find "$BACKUPS_DIR" -mindepth 1 -maxdepth 1 -type d -mtime +"$KEEP_DAYS" -print -exec rm -r {} +

log "Backup complete"
echo "$OUT"
