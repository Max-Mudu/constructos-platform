#!/usr/bin/env bash
# Runner load helpers for smoke.sh (sourced). Run 44273008612 showed the API
# answering a validation error in 3.4 s and logins not within the app's 15 s
# timeout while the simulator and Maestro were running, after a 24-minute
# build. These helpers log memory and the busiest processes, free what the
# build left behind, keep the API ahead of the simulator, and wait until the
# API answers a login quickly before each flow, so a slow runner shows up as
# a slow runner in the log instead of as an app failure.

API_ORIGIN="${API_ORIGIN:-http://localhost:3001}"

runner_snapshot() {
  echo "--- $1"
  sysctl -n vm.swapusage 2>/dev/null | sed 's/^/swap: /' || true
  memory_pressure 2>/dev/null | tail -n 1 || true
  top -l 1 -o mem -n 8 -stats pid,command,cpu,mem 2>/dev/null | tail -n 9 || true
}

free_runner() {
  echo "::group::Runner load before the flows"
  runner_snapshot "before cleanup"
  # Xcode's build service stays alive (and large) after xcodebuild returns.
  for p in SWBBuildService XCBBuildService; do
    if pgrep -x "$p" >/dev/null 2>&1; then echo "Stopping $p"; pkill -x "$p" || true; fi
  done
  # Give the API and PostgreSQL priority over the simulator and Maestro.
  for pid in $(pgrep -f "src/server.ts" 2>/dev/null) $(pgrep -x postgres 2>/dev/null); do
    sudo -n renice -n -10 -p "$pid" >/dev/null 2>&1 || true
  done
  echo "Reniced API/PostgreSQL processes: $(pgrep -f "src/server.ts" 2>/dev/null | wc -l | tr -d ' ') API, $(pgrep -x postgres 2>/dev/null | wc -l | tr -d ' ') postgres"
  sleep 5
  runner_snapshot "after cleanup"
  echo "::endgroup::"
}

# One timed API login with the admin account; prints "<http code> <seconds>".
api_login_time() {
  curl -sS -o /dev/null -m 30 -w '%{http_code} %{time_total}' -X POST "$API_ORIGIN/api/v1/auth/login" \
    -H 'Content-Type: application/json' \
    --data "{\"email\":\"$SMOKE_EMAIL\",\"password\":\"$SMOKE_PASSWORD\"}" 2>/dev/null || echo "000 30"
}

# Waits (up to 3 minutes) until an API login answers 200 in under 5 s.
wait_for_fast_api() {
  local start r code secs
  start=$(date +%s)
  while :; do
    r="$(api_login_time)"; code="${r%% *}"; secs="${r##* }"
    if [ "$code" = 200 ] && awk "BEGIN{exit !($secs < 5)}"; then
      echo "API PROBE before $1: login HTTP $code in ${secs}s"
      return 0
    fi
    if [ $(( $(date +%s) - start )) -ge 180 ]; then
      echo "::warning::API PROBE before $1: still slow after 3 minutes (last: HTTP $code in ${secs}s)"
      runner_snapshot "slow API"
      return 1
    fi
    echo "API PROBE before $1: HTTP $code in ${secs}s, waiting"
    sleep 10
  done
}
