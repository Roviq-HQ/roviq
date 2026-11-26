#!/usr/bin/env bash
# Deploys one commit to the staging stack (docs/deployment.md → "Staging").
#
#   STAGING_ENV_FILE=<env file> scripts/staging/staging-deploy.sh <commit, branch or tag>
#
# Order: export the commit, build its images, back up, start the infrastructure, set the runtime
# role's password, check an external object store, migrate, essential seed, buckets (in-stack store
# only), first admin, start the apps, smoke-check
# through the public names. A failure after the migration puts the previous release's apps back;
# when that release cannot run on the migrated schema, restore the backup printed above.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=staging-lib.sh
. "$SCRIPT_DIR/staging-lib.sh"

: "${STAGING_WEB_HOSTS:?}" "${STAGING_API_URL:?}" "${STAGING_CA_CERT:?}" "${INSTITUTE_PORTAL_URL:?}"
: "${STAGING_ADMIN_USERNAME:?}" "${STAGING_ADMIN_EMAIL:?}" "${POSTGRES_POOLER_PASSWORD:?}"
: "${POSTGRES_AUDIT_WRITER_PASSWORD:?}"

REF="${1:?usage: staging-deploy.sh <commit, branch or tag>}"

# ── 1. Export the commit ─────────────────────────────────────
git -C "$REPO_DIR" fetch --quiet origin
# A branch name means the remote branch: the clone's local branches are never updated.
SHA="$(git -C "$REPO_DIR" rev-parse --verify --short=12 "origin/$REF^{commit}" 2>/dev/null ||
    git -C "$REPO_DIR" rev-parse --verify --short=12 "$REF^{commit}")"
REL="$RELEASES_DIR/$SHA"
PREVIOUS="$(current_release || true)"
log "Deploying $SHA (previous: ${PREVIOUS:-none})"

if [[ ! -d "$REL" ]]; then
    mkdir -p "$REL.tmp"
    git -C "$REPO_DIR" archive "$SHA" | tar -x -C "$REL.tmp"
    mv "$REL.tmp" "$REL"
fi
cp "$REL/docker/init-db.sh" "$STAGING_STATE_DIR/init-db.sh"
# The nightly backup runs these copies, so it always matches the deployed release.
[[ -d "$REL/scripts/staging" ]] || { log "$SHA has no scripts/staging: it predates staging"; exit 1; }
mkdir -p "$STAGING_STATE_DIR/bin"
cp "$REL"/scripts/staging/*.sh "$STAGING_STATE_DIR/bin/"

# A switch to an external store starts from a release that has the override, so its backup and its
# rollback understand the mode (docs/deployment.md → "Staging").
if external_store && [[ -n "$PREVIOUS" && "$PREVIOUS" != "$SHA" ]] &&
    ! has_external_store_support "$RELEASES_DIR/$PREVIOUS"; then
    log "$PREVIOUS has no external object store support. Deploy $SHA with"
    log "STAGING_OBJECT_STORE=in-stack first, then switch to external."
    exit 1
fi

# ── 2. Build the images ──────────────────────────────────────
build() {
    local name="$1" dockerfile="$2"
    shift 2
    local tag="$STAGING_IMAGE_PREFIX/$name:$SHA"
    if docker image inspect "$tag" >/dev/null 2>&1; then
        log "Image $tag exists"
        return
    fi
    log "Building $tag"
    docker build --quiet -f "$REL/docker/$dockerfile" --target "$name" -t "$tag" "$@" "$REL" >/dev/null
}
build migrator Dockerfile.backend
build api-gateway Dockerfile.backend
build notification-service Dockerfile.backend
build web Dockerfile.web \
    --build-arg NEXT_PUBLIC_API_URL="$STAGING_API_URL" \
    --build-arg NEXT_PUBLIC_INSTITUTE_URL="$INSTITUTE_PORTAL_URL" \
    --build-arg NEXT_PUBLIC_ROVIQ_EE=true

# ── 3. Back up ───────────────────────────────────────────────
BACKUP=""
if [[ -n "$PREVIOUS" && "$PREVIOUS" != "$SHA" ]]; then
    BACKUP="$("$SCRIPT_DIR/staging-backup.sh" --keep-stopped | tail -1)"
    log "Backup before migrating: $BACKUP"
fi

# ── 4. Infrastructure ────────────────────────────────────────
log "Starting the infrastructure"
stg_compose "$REL" up -d --wait --remove-orphans "${INFRA_SERVICES[@]}"

log "Setting the runtime role's password"
printf '%s\n' '\getenv pw POSTGRES_POOLER_PASSWORD' "ALTER ROLE roviq_pooler PASSWORD :'pw';" |
    stg_compose "$REL" exec -T -e POSTGRES_POOLER_PASSWORD postgres \
        psql -q -v ON_ERROR_STOP=1 -U roviq -d roviq >/dev/null

# ── 5. Migrate, essential seed, buckets, first admin ────────
migrated=false
rollback() {
    local status=$?
    [[ $status -eq 0 || "$migrated" == false ]] && return
    log "Deploy of $SHA failed after the migration."
    if [[ -n "$PREVIOUS" && "$PREVIOUS" != "$SHA" ]]; then
        log "Starting the apps of $PREVIOUS again."
        stg_compose "$RELEASES_DIR/$PREVIOUS" up -d "${APP_SERVICES[@]}" || true
        log "If $PREVIOUS cannot run on the migrated schema, restore $BACKUP"
        log "(scripts/staging/staging-restore.sh)."
    fi
}
trap rollback EXIT

if external_store; then
    # Before the migration: a store that fails its check stops the deploy with nothing changed.
    log "Checking the external object store"
    stg_compose "$REL" run --rm -w /app migrator pnpm run storage:check
fi

log "Running migrations"
stg_compose "$REL" run --rm migrator
migrated=true
# The migrations create roviq_audit_writer, so its password is set after them.
printf '%s\n' '\getenv pw POSTGRES_AUDIT_WRITER_PASSWORD' "ALTER ROLE roviq_audit_writer PASSWORD :'pw';" |
    stg_compose "$REL" exec -T -e POSTGRES_AUDIT_WRITER_PASSWORD postgres \
        psql -q -v ON_ERROR_STOP=1 -U roviq -d roviq >/dev/null
if external_store; then
    # An external store's buckets and rules are set up outside the stack.
    log "Essential seed"
    stg_compose "$REL" run --rm -w /app migrator pnpm run db:seed:essential
else
    log "Essential seed and buckets"
    stg_compose "$REL" run --rm -w /app migrator sh -c 'pnpm run db:seed:essential && pnpm run storage:init'
fi
log "First platform admin"
ADMIN_FILE="$STAGING_STATE_DIR/first-admin-password"
ADMIN_OUT="$(stg_compose "$REL" run --rm -T -w /app migrator \
    pnpm run --silent admin:create --username "$STAGING_ADMIN_USERNAME" --email "$STAGING_ADMIN_EMAIL")"
if grep -q 'Temporary password' <<<"$ADMIN_OUT"; then
    # The password never reaches the deploy log.
    (umask 077 && tail -1 <<<"$ADMIN_OUT" >"$ADMIN_FILE")
    log "Created platform admin $STAGING_ADMIN_USERNAME; temporary password in $ADMIN_FILE"
else
    log "$(tail -1 <<<"$ADMIN_OUT")"
fi

# ── 6. Apps ──────────────────────────────────────────────────
log "Starting the apps"
stg_compose "$REL" up -d --remove-orphans "${APP_SERVICES[@]}"

# ── 7. Smoke check through the public names ─────────────────
check() {
    local url="$1" expect="$2" code=""
    for _ in $(seq 1 60); do
        code="$(curl -s -o /dev/null -w '%{http_code}' --cacert "$STAGING_CA_CERT" --max-time 5 "$url" || true)"
        [[ "$code" =~ $expect ]] && { log "OK $code $url"; return 0; }
        sleep 2
    done
    log "FAILED $url answered ${code:-nothing}"
    return 1
}
check "$STAGING_API_URL/api/health" '^200$'
for host in $STAGING_WEB_HOSTS; do
    check "https://$host/" '^(200|30[78])$'
done

echo "$SHA" >"$CURRENT_FILE"
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $SHA previous=${PREVIOUS:-none} backup=${BACKUP:-none}" >>"$DEPLOY_LOG"
log "Deployed $SHA"
