#!/usr/bin/env bash
# Restores a staging backup into a separate, fresh Compose project and starts it there, so the
# restore can be checked without touching the running stack.
#
#   STAGING_ENV_FILE=<env file> scripts/staging/staging-restore.sh <backup folder> [project]
#
# The project defaults to "<staging project>-restore" and must not exist yet. It gets its own
# volumes and a private network instead of the proxy's, so nothing outside the host can reach
# it. The API answers on 127.0.0.1:$STAGING_RESTORE_API_PORT (default 13999). Remove the drill,
# volumes included, with: staging-restore.sh --remove <backup folder> [project]
#
# An encrypted backup (`*.gpg` files) is decrypted with the private key in the keyring of the
# user who runs the drill, or with the key file named by STAGING_BACKUP_PRIVATE_KEY_FILE, which
# is read into a keyring that is removed when the script ends. The private key does not live
# on the staging host: bring it for the drill and take it away again.
#
# A backup taken with an external store holds no objects, and the drill restores and starts the
# databases only: apps started here would share the live buckets, and the restored file
# sweeper could delete objects the live stack still uses.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=staging-lib.sh
. "$SCRIPT_DIR/staging-lib.sh"

REMOVE=false
if [[ "${1:-}" == "--remove" ]]; then
    REMOVE=true
    shift
fi
BACKUP="${1:?usage: staging-restore.sh [--remove] <backup folder> [project]}"
TARGET="${2:-${STAGING_PROJECT}-restore}"
[[ "$TARGET" != "$STAGING_PROJECT" ]] || { echo "Refusing to use the live project" >&2; exit 1; }
[[ -f "$BACKUP/manifest" ]] || { echo "$BACKUP has no manifest" >&2; exit 1; }
SHA="$(sed -n 's/^release=//p' "$BACKUP/manifest")"
# The store the backup was taken with decides what is restored, not today's env file. A backup
# from before the manifest recorded it was taken with the in-stack store.
backup_store="$(sed -n 's/^object_store=//p' "$BACKUP/manifest")"
set_object_store "${backup_store:-in-stack}"
REL="$RELEASES_DIR/$SHA"
[[ -d "$REL" ]] || { echo "Release $SHA of the backup is not in $RELEASES_DIR" >&2; exit 1; }

if [[ "$REMOVE" == true ]]; then
    docker rm -f "$TARGET-api-port" >/dev/null 2>&1 || true
    STAGING_PROJECT="$TARGET" STAGING_PROXY_NETWORK="$TARGET-net" \
        STAGING_METRICS_PORT=13998 stg_compose "$REL" down -v
    docker network rm "$TARGET-net" >/dev/null 2>&1 || true
    log "Removed $TARGET"
    exit 0
fi

if docker volume ls -q --filter "label=com.docker.compose.project=$TARGET" | grep -q .; then
    echo "Project $TARGET already has volumes; restore needs fresh ones." >&2
    exit 1
fi

if [[ -n "${STAGING_BACKUP_PRIVATE_KEY_FILE:-}" ]]; then
    GNUPGHOME="$(mktemp -d)"
    export GNUPGHOME
    trap 'rm -rf "$GNUPGHOME"' EXIT
    gpg --batch --quiet --no-tty --import "$STAGING_BACKUP_PRIVATE_KEY_FILE"
fi
# Writes one file of the backup to stdout, decrypting it when the backup is encrypted.
backup_file() {
    if [[ -f "$BACKUP/$1.gpg" ]]; then
        gpg --batch --quiet --no-tty --decrypt "$BACKUP/$1.gpg"
    else
        cat "$BACKUP/$1"
    fi
}
has_backup_file() { [[ -f "$BACKUP/$1.gpg" || -f "$BACKUP/$1" ]]; }

START="$(date +%s)"
export STAGING_PROJECT="$TARGET"
export STAGING_PROXY_NETWORK="$TARGET-net"
docker network inspect "$STAGING_PROXY_NETWORK" >/dev/null 2>&1 ||
    docker network create --internal "$STAGING_PROXY_NETWORK" >/dev/null
# Host-only ports must not clash with the running stack.
export STAGING_METRICS_PORT="${STAGING_RESTORE_METRICS_PORT:-13998}"

if ! external_store; then
    has_backup_file objects.tar.gz || {
        echo "$BACKUP holds no object archive (taken with an external store)" >&2
        exit 1
    }
    log "Restoring the object store into $TARGET"
    docker volume create --label "com.docker.compose.project=$TARGET" \
        --label com.docker.compose.volume=roviq-objects "${TARGET}_roviq-objects" >/dev/null
    backup_file objects.tar.gz |
        docker run --rm -i -v "${TARGET}_roviq-objects:/data" postgres:18-alpine tar -C /data -xzf -
fi

log "Starting a fresh database"
stg_compose "$REL" up -d --wait postgres

log "Restoring the database roles"
# Roles belong to the cluster, not the dump; policies name them. Roles that init-db.sh already
# created report "already exists", which is expected.
backup_file roles.sql |
    stg_compose "$REL" exec -T postgres psql -q -U roviq -d postgres >/dev/null 2>&1 || true

log "Restoring the databases"
backup_file roviq.dump |
    stg_compose "$REL" exec -T postgres pg_restore -U roviq -d roviq --exit-on-error
for db in temporal temporal_visibility; do
    stg_compose "$REL" exec -T postgres createdb -U roviq "$db"
    backup_file "$db.dump" |
        stg_compose "$REL" exec -T postgres pg_restore -U roviq -d "$db" --exit-on-error
done
printf '%s\n' '\getenv pw POSTGRES_POOLER_PASSWORD' "ALTER ROLE roviq_pooler PASSWORD :'pw';" \
    '\getenv aw POSTGRES_AUDIT_WRITER_PASSWORD' "ALTER ROLE roviq_audit_writer PASSWORD :'aw';" |
    stg_compose "$REL" exec -T -e POSTGRES_POOLER_PASSWORD -e POSTGRES_AUDIT_WRITER_PASSWORD postgres \
        psql -q -v ON_ERROR_STOP=1 -U roviq -d roviq >/dev/null

log "Starting the restored stack (no migration, no seed)"
stg_compose "$REL" up -d --wait "${INFRA_SERVICES[@]}"
if external_store; then
    log "Restored the databases of $BACKUP into $TARGET in $(($(date +%s) - START)) s."
    log "The apps were not started: they would share the live external buckets."
    exit 0
fi
stg_compose "$REL" up -d "${APP_SERVICES[@]}"

API_PORT="${STAGING_RESTORE_API_PORT:-13999}"
docker run -d --rm --name "$TARGET-api-port" --network "${TARGET}_backplane" \
    -p "127.0.0.1:$API_PORT:3000" alpine/socat TCP-LISTEN:3000,fork,reuseaddr TCP:api-gateway:3000 >/dev/null

for _ in $(seq 1 60); do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:$API_PORT/api/health" || true)"
    [[ "$code" == 200 ]] && break
    sleep 2
done
[[ "$code" == 200 ]] || { log "The restored API did not become healthy ($code)"; exit 1; }

log "Restored $BACKUP into $TARGET in $(($(date +%s) - START)) s; API on 127.0.0.1:$API_PORT"
