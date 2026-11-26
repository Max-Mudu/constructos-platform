#!/usr/bin/env bash
# Starts and stops the API on this runner (sourced by start-backend.sh and
# smoke.sh). The flows need to stop it (offline queue) and to restart it with
# short-lived access tokens (token refresh), and every start loads the timing
# preload (api-timing.cjs) so each request is timed inside the API process.
#
# api_start [NAME=value ...]   start with the saved environment plus overrides
# api_stop                      stop it and wait until the port is closed
# The environment (throwaway database URL, dummy CI secrets) is saved by
# start-backend.sh in $RUNNER_TEMP/api.env, readable by this user only, and is
# never printed.

API_CTL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_REPO_ROOT="$(cd "$API_CTL_DIR/../../.." && pwd)"
API_ORIGIN="${API_ORIGIN:-http://localhost:3001}"
API_PORT=3001

api_listener_pid() { lsof -ti "tcp:$API_PORT" -sTCP:LISTEN 2>/dev/null | awk 'NR==1'; }

# Filter for anything copied from a log file into the job log or the artifact:
# one-time setup links (the API prints them outside production), bearer values
# and JWTs. Nothing of the kind should be there; this keeps it that way.
scrub_log() {
  LC_ALL=C sed -E \
    -e 's/[?&]?token=[^ &"]*/[value removed]/g' \
    -e 's/Bearer [A-Za-z0-9._~+\/=-]+/[bearer value removed]/g' \
    -e 's/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9._-]+/[jwt removed]/g'
}

api_renice() {
  # Give the API and PostgreSQL priority over the simulator and Maestro.
  local pid
  for pid in $(pgrep -f "src/server.ts" 2>/dev/null) $(pgrep -x postgres 2>/dev/null); do
    sudo -n renice -n -10 -p "$pid" >/dev/null 2>&1 || true
  done
}

api_start() {
  : "${OUT:?}" "${RUNNER_TEMP:?}"
  if [ -n "$(api_listener_pid)" ]; then
    echo "::error::api_start: something already listens on port $API_PORT"
    return 1
  fi
  (
    set -a
    # shellcheck disable=SC1091
    . "$RUNNER_TEMP/api.env"
    set +a
    for kv in "$@"; do export "${kv?}"; done
    export API_TIMING_LOG="$OUT/logs/api-timing.jsonl"
    export NODE_OPTIONS="--require $API_CTL_DIR/api-timing.cjs --require $API_CTL_DIR/weak-network.cjs"
    # Slow answers are switched on only while smoke.sh has written this file
    # (weak-network.cjs); it does not exist otherwise.
    export CI_WEAK_NETWORK_FILE="$RUNNER_TEMP/weak-network.json"
    cd "$API_REPO_ROOT/packages/api" || exit 1
    nohup npx tsx src/server.ts >> "$OUT/logs/api.log" 2>&1 &
  )
  local i
  for i in $(seq 1 90); do
    if curl -fsS -o /dev/null "$API_ORIGIN/health" 2>/dev/null; then
      api_renice
      echo "API answered /health after about ${i}s (process $(api_listener_pid); overrides: ${*:-none})"
      return 0
    fi
    sleep 1
  done
  echo "::error::The API did not answer on $API_ORIGIN/health within 90 s"
  return 1
}

api_stop() {
  local pid i
  pid="$(api_listener_pid)"
  # The npx and tsx wrappers as well as the server itself.
  pkill -f "src/server.ts" 2>/dev/null || true
  if [ -n "$pid" ]; then kill "$pid" 2>/dev/null || true; fi
  for i in $(seq 1 15); do
    if [ -z "$(api_listener_pid)" ]; then
      echo "API stopped (was process ${pid:-?}); port $API_PORT is closed"
      return 0
    fi
    sleep 1
  done
  pid="$(api_listener_pid)"
  if [ -n "$pid" ]; then kill -9 "$pid" 2>/dev/null || true; fi
  sleep 1
  if [ -z "$(api_listener_pid)" ]; then echo "API stopped after a forced kill"; return 0; fi
  echo "::error::The API is still listening on port $API_PORT"
  return 1
}
