#!/usr/bin/env bash
# Shared by the staging scripts. Reads the staging env file and defines `stg_compose`.
# STAGING_ENV_FILE names the env file; docs/deployment.md → "Staging" lists what it must hold.

: "${STAGING_ENV_FILE:?STAGING_ENV_FILE must name the staging env file}"
[[ -r "$STAGING_ENV_FILE" ]] || { echo "Cannot read $STAGING_ENV_FILE" >&2; exit 1; }

set -a
# shellcheck disable=SC1090
. "$STAGING_ENV_FILE"
set +a

: "${STAGING_PROJECT:?}" "${STAGING_STATE_DIR:?}" "${STAGING_IMAGE_PREFIX:?}"

# `in-stack` (the default) runs RustFS in the stack; `external` uses the store the S3_* values name.
STAGING_OBJECT_STORE="${STAGING_OBJECT_STORE:-in-stack}"
case "$STAGING_OBJECT_STORE" in
in-stack | external) ;;
*)
    echo "STAGING_OBJECT_STORE must be in-stack or external, not $STAGING_OBJECT_STORE" >&2
    exit 1
    ;;
esac

RELEASES_DIR="$STAGING_STATE_DIR/releases"
BACKUPS_DIR="$STAGING_STATE_DIR/backups"
CURRENT_FILE="$STAGING_STATE_DIR/current"
DEPLOY_LOG="$STAGING_STATE_DIR/deploys.log"
mkdir -p "$RELEASES_DIR" "$BACKUPS_DIR"

log() { printf '[staging %s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }

external_store() { [[ "$STAGING_OBJECT_STORE" == external ]]; }

# Compose for one release: the release's own compose files, the staging project name.
stg_compose() {
    local release_dir="$1"
    shift
    local files=(-f "$release_dir/docker/compose.app.yaml" -f "$release_dir/docker/compose.staging.yaml")
    if external_store; then
        local external="$release_dir/docker/compose.staging-external-store.yaml"
        [[ -f "$external" ]] || {
            echo "$(basename "$release_dir") has no external object store support" >&2
            return 1
        }
        files+=(-f "$external")
    fi
    ROVIQ_VERSION="$(basename "$release_dir")" docker compose \
        -p "$STAGING_PROJECT" \
        --env-file "$STAGING_ENV_FILE" \
        --project-directory "$release_dir/docker" \
        "${files[@]}" \
        "$@"
}

current_release() {
    [[ -s "$CURRENT_FILE" ]] && cat "$CURRENT_FILE"
}

APP_SERVICES=(api-gateway notification-service web)
INFRA_SERVICES=(postgres redis nats openobserve temporal temporal-ui mailpit)
external_store || INFRA_SERVICES+=(object-storage)
