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
REL="$RELEASES_DIR/$SHA"
[[ -d "$REL" ]] || { echo "Release $SHA of the backup is not in $RELEASES_DIR" >&2; exit 1; }

if [[ "$REMOVE" == true ]]; then
    docker rm -f "$TARGET-api-port" >/dev/null 2>&1 || true
    STAGING_PROJECT="$TARGET" STAGING_PROXY_NETWORK="$TARGET-net" \
        STAGING_METRICS_PORT=13998 STAGING_WORKFLOWS_PORT=13997 stg_compose "$REL" down -v
    docker network rm "$TARGET-net" >/dev/null 2>&1 || true
    log "Removed $TARGET"
    exit 0
fi

if docker volume ls -q --filter "label=com.docker.compose.project=$TARGET" | grep -q .; then
    echo "Project $TARGET already has volumes; restore needs fresh ones." >&2
    exit 1
fi

START="$(date +%s)"
export STAGING_PROJECT="$TARGET"
export STAGING_PROXY_NETWORK="$TARGET-net"
docker network inspect "$STAGING_PROXY_NETWORK" >/dev/null 2>&1 ||
    docker network create --internal "$STAGING_PROXY_NETWORK" >/dev/null
# Host-only ports must not clash with the running stack.
export STAGING_METRICS_PORT="${STAGING_RESTORE_METRICS_PORT:-13998}"
export STAGING_WORKFLOWS_PORT="${STAGING_RESTORE_WORKFLOWS_PORT:-13997}"

log "Restoring the object store into $TARGET"
docker volume create --label "com.docker.compose.project=$TARGET" \
    --label com.docker.compose.volume=roviq-objects "${TARGET}_roviq-objects" >/dev/null
docker run --rm -v "${TARGET}_roviq-objects:/data" -v "$BACKUP:/in:ro" \
    postgres:18-alpine tar -C /data -xzf /in/objects.tar.gz

log "Starting a fresh database"
stg_compose "$REL" up -d --wait postgres

log "Restoring the databases"
stg_compose "$REL" exec -T postgres pg_restore -U roviq -d roviq --exit-on-error <"$BACKUP/roviq.dump"
for db in temporal temporal_visibility; do
    stg_compose "$REL" exec -T postgres createdb -U roviq "$db"
    stg_compose "$REL" exec -T postgres pg_restore -U roviq -d "$db" --exit-on-error <"$BACKUP/$db.dump"
done
printf '%s\n' '\getenv pw POSTGRES_POOLER_PASSWORD' "ALTER ROLE roviq_pooler PASSWORD :'pw';" |
    stg_compose "$REL" exec -T -e POSTGRES_POOLER_PASSWORD postgres \
        psql -q -v ON_ERROR_STOP=1 -U roviq -d roviq >/dev/null

log "Starting the restored stack (no migration, no seed)"
stg_compose "$REL" up -d --wait "${INFRA_SERVICES[@]}"
stg_compose "$REL" up -d "${APP_SERVICES[@]}"

API_PORT="${STAGING_RESTORE_API_PORT:-13999}"
docker run -d --rm --name "$TARGET-api-port" --network "${TARGET}_roviq-net" \
    -p "127.0.0.1:$API_PORT:3000" alpine/socat TCP-LISTEN:3000,fork,reuseaddr TCP:api-gateway:3000 >/dev/null

for _ in $(seq 1 60); do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:$API_PORT/api/health" || true)"
    [[ "$code" == 200 ]] && break
    sleep 2
done
[[ "$code" == 200 ]] || { log "The restored API did not become healthy ($code)"; exit 1; }

log "Restored $BACKUP into $TARGET in $(($(date +%s) - START)) s; API on 127.0.0.1:$API_PORT"
