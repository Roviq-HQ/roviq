#!/usr/bin/env bash
# Single entry point for the e2e Docker stack (local scripts, ci:check, CI).
# Usage: scripts/e2e-compose.sh <docker compose args…>
set -euo pipefail
cd "$(dirname "$0")/.."

# Bind-mount targets must exist and belong to the invoking user; Docker
# creates missing ones as root. .e2e/ holds the containers' dist and Nx
# state, mounted over dist/ and .nx/ inside the container.
mkdir -p dist .nx .e2e/dist .e2e/nx

export E2E_WORKSPACE="$PWD"
# Containers run as the invoking user so files written into the bind mount
# stay owned by that user (UID 1001 on GitHub runners, 1000 locally).
export E2E_UID="${E2E_UID:-$(id -u)}"
export E2E_GID="${E2E_GID:-$(id -g)}"

. scripts/instance-env.sh

# The backend containers run a fixed build made at container start. This hash of
# the backend's inputs is part of their environment, so `up` recreates them
# (and rebuilds) exactly when the source they would build has changed.
backend_inputs=(
  apps/api-gateway apps/notification-service libs ee
  package.json pnpm-lock.yaml nx.json tsconfig.base.json
  docker/compose.e2e.yaml docker/Dockerfile.backend
  ':(exclude)*.spec.ts' ':(exclude)*.spec.tsx' ':(exclude)libs/frontend'
)
E2E_BACKEND_FINGERPRINT=$(
  {
    git ls-files -s -- "${backend_inputs[@]}"
    git diff -- "${backend_inputs[@]}"
    git ls-files -z --others --exclude-standard -- "${backend_inputs[@]}" | xargs -0 -r sha1sum
    [[ -f .env ]] && sha1sum .env
  } | sha1sum | cut -d' ' -f1
)
export E2E_BACKEND_FINGERPRINT

exec docker compose -p "${ROVIQ_E2E_COMPOSE_PROJECT:-roviq-e2e}" -f docker/compose.e2e.yaml "$@"
