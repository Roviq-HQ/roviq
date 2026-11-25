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
  line=$(cat "$holder" 2>/dev/null || echo unknown holder)
  pid=$(sed -n 's/.*pid \([0-9]*\),.*/\1/p' <<< "$line")
  if [[ -n "$pid" ]] && ! kill -0 "$pid" 2>/dev/null; then
    echo "stale: the gate is gone ($line) but a process it started still holds the lock:"
    fuser "$lock" 2>&1 | sed 's/^/  /' || true
    echo "a push started now takes a new lock after about 40 seconds"
  else
    echo "busy: $line"
    echo "a push started now waits for it, then runs its own gate"
  fi
fi
