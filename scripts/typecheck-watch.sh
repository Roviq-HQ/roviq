#!/usr/bin/env bash
# The backend type-check watchers, restarted together when they pass
# DEV_TYPECHECK_MEMORY_CAP_MB (default 3584; 0 = never). A restart checks both apps from scratch.
# The cap sits above what the first check of both apps needs (about 2.8 GB), or it would loop.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
# shellcheck source=scripts/instance-env.sh
. scripts/instance-env.sh
watch='tsc --noEmit --watch --preserveWatchOutput --rootDir . -p'
exec scripts/with-memory-cap.sh typecheck "${DEV_TYPECHECK_MEMORY_CAP_MB:-3584}" -- \
  sh -c "$watch apps/api-gateway/tsconfig.app.json & $watch apps/notification-service/tsconfig.app.json & wait"
