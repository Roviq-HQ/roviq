#!/usr/bin/env bash
# The dev web server, restarted when it passes DEV_WEB_MEMORY_CAP_MB (default 6144; 0 = never).
# `next dev` keeps every route it has compiled in memory.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
# shellcheck source=scripts/instance-env.sh
. scripts/instance-env.sh
exec scripts/with-memory-cap.sh dev-web "${DEV_WEB_MEMORY_CAP_MB:-6144}" -- \
  pnpm exec nx dev web -- -p "${WEB_PORT:-4200}" --hostname 0.0.0.0
