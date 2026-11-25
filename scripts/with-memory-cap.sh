#!/usr/bin/env bash
# Runs a long-lived dev command and restarts it when it grows past a memory cap.
#   scripts/with-memory-cap.sh <name> <cap in MB, 0 = no cap> -- <command…>
# The dev web server and the type-check watchers keep everything they have built in memory and
# never give it back; with several checkouts running, that starves the test runs.
set -uo pipefail

name=$1
cap_mb=$2
shift 3
child_pid=""

# The command and everything it starts share one session, so one sum and one signal reach all.
session_rss_mb() {
  ps -o rss= -s "$child_pid" 2>/dev/null | awk '{ sum += $1 } END { printf "%d", sum / 1024 }'
}

stop_child() {
  [[ -n "$child_pid" ]] || return 0
  kill -TERM -- "-$child_pid" 2>/dev/null || true
  for _ in {1..20}; do
    ps -s "$child_pid" > /dev/null 2>&1 || break
    sleep 0.5
  done
  kill -KILL -- "-$child_pid" 2>/dev/null || true
  wait "$child_pid" 2>/dev/null || true
  child_pid=""
}
trap 'stop_child; exit 0' INT TERM
trap stop_child EXIT

while :; do
  setsid "$@" &
  child_pid=$!
  while kill -0 "$child_pid" 2>/dev/null; do
    sleep ${CAP_POLL_SECONDS:-30} &
    wait $! 2>/dev/null || true
    (( cap_mb > 0 )) || continue
    used=$(session_rss_mb)
    if (( used > cap_mb )); then
      echo "[$name] uses ${used} MB, over the ${cap_mb} MB cap: restarting it"
      stop_child
      break
    fi
  done
  if [[ -n "$child_pid" ]]; then
    # It ended by itself: report that to Tilt instead of looping on a broken start.
    wait "$child_pid"
    exit $?
  fi
done
