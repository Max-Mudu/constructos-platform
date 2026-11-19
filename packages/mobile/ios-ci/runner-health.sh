#!/usr/bin/env bash
# Runner load helpers for smoke.sh (sourced). Run 44273008612 showed the API
# answering a validation error in 3.4 s and logins not within the app's 15 s
# timeout while the simulator and Maestro were running, after a 24-minute
# build. These helpers log memory and the busiest processes, free what the
# build left behind, keep the API ahead of the simulator, and wait until the
# API answers a login quickly before each flow, so a slow runner shows up as
# a slow runner in the log instead of as an app failure.
#
# They also collect the control measurements for the sign-in latency report
# (latency-report.mjs): every timed curl login goes to logs/probes.tsv and a
# background sampler writes the load average and the busiest processes to
# logs/load-samples.log every 3 seconds.

API_ORIGIN="${API_ORIGIN:-http://localhost:3001}"

# UTC time with milliseconds (BSD date has no sub-second format).
now_iso() {
  perl -MTime::HiRes=gettimeofday -MPOSIX=strftime -e '($s,$u)=gettimeofday; printf "%s.%03dZ\n", strftime("%Y-%m-%dT%H:%M:%S", gmtime($s)), $u/1000'
}

load_average() { sysctl -n vm.loadavg 2>/dev/null | tr -d '{}' | xargs; }

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

# Every 3 s: "@ <UTC time> load <1m> <5m> <15m>" and the 14 processes using
# the most CPU (pid, %cpu, cumulative CPU time, executable). The report takes
# the difference in cumulative CPU time between two samples, so it shows which
# processes had the cores while a request was open. Costs one `ps` per sample.
load_sampler_start() {
  : "${OUT:?}" "${RUNNER_TEMP:?}"
  (
    while :; do
      printf '@ %s load %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(load_average)"
      ps -Ao pid=,pcpu=,time=,comm= -r 2>/dev/null | head -n 14
      sleep 3
    done
  ) >> "$OUT/logs/load-samples.log" 2>/dev/null &
  echo $! > "$RUNNER_TEMP/load-sampler.pid"
  echo "Load sampler started (every 3 s, logs/load-samples.log)"
}

load_sampler_stop() {
  if [ -f "$RUNNER_TEMP/load-sampler.pid" ]; then
    kill "$(cat "$RUNNER_TEMP/load-sampler.pid")" 2>/dev/null || true
    rm -f "$RUNNER_TEMP/load-sampler.pid"
  fi
}

# One timed API login with the admin account; prints "<http code> <seconds>".
api_login_time() {
  curl -sS -o /dev/null -m 30 -w '%{http_code} %{time_total}' -X POST "$API_ORIGIN/api/v1/auth/login" \
    -H 'Content-Type: application/json' \
    --data "{\"email\":\"$SMOKE_EMAIL\",\"password\":\"$SMOKE_PASSWORD\"}" 2>/dev/null || echo "000 30"
}

# api_probe <label>: one timed login, written to the job log and to
# logs/probes.tsv (start time, label, HTTP status, seconds). Sets PROBE_CODE
# and PROBE_SECS.
api_probe() {
  local at r
  at="$(now_iso)"
  r="$(api_login_time)"
  PROBE_CODE="${r%% *}"
  PROBE_SECS="${r##* }"
  printf '%s\t%s\t%s\t%s\n' "$at" "$1" "$PROBE_CODE" "$PROBE_SECS" >> "$OUT/logs/probes.tsv"
  echo "API PROBE $1: login HTTP $PROBE_CODE in ${PROBE_SECS}s at $at (load $(load_average))"
}

# Waits (up to 3 minutes) until an API login answers 200 in under 5 s.
wait_for_fast_api() {
  local start
  start=$(date +%s)
  while :; do
    api_probe "before $1"
    if [ "$PROBE_CODE" = 200 ] && awk "BEGIN{exit !($PROBE_SECS < 5)}"; then
      return 0
    fi
    if [ $(( $(date +%s) - start )) -ge 180 ]; then
      echo "::warning::API PROBE before $1: still slow after 3 minutes (last: HTTP $PROBE_CODE in ${PROBE_SECS}s)"
      runner_snapshot "slow API"
      return 1
    fi
    echo "API PROBE before $1: waiting 10 s"
    sleep 10
  done
}
