#!/usr/bin/env bash
# Shows whether a pre-push gate is running on this machine, and whose (scripts/ci-check.sh).
set -euo pipefail
dir="${XDG_CACHE_HOME:-$HOME/.cache}/roviq"
lock="$dir/ci-check.lock"
holder="$dir/ci-check.holder"
if [[ ! -e "$lock" ]]; then
  echo "free: no gate has run on this machine yet"
  exit 0
fi
exec {fd}<"$lock"
if flock -n "$fd"; then
  echo "free: no gate is running"
else
  echo "busy: $(cat "$holder" 2>/dev/null || echo unknown holder)"
  echo "a push started now waits for it, then runs its own gate"
fi
