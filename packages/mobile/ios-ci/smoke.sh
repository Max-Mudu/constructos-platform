#!/usr/bin/env bash
# Drives the installed app with Maestro against the API on this runner and
# confirms through the API what the app wrote. Which flows run depends on the
# job (SIGNING, SUITE):
#
#   unsigned build        01 (login screen) only
#   SUITE=regression      01 to 05: wrong password, company admin tabs and
#                         logout, project manager and site supervisor tabs
#                         with API data, attendance writes, reinstall while
#                         signed in; then a latency control (curl logins while
#                         the test driver polls the screen)
#   SUITE=operations      01, then 06 PDF share sheet (report, drawing),
#                         07 delivery without a camera, 08 offline queue
#                         (API stopped and started), 09 session persistence,
#                         token refresh after expiry and logout (API restarted
#                         with 2-minute access tokens), 10 simulated push
#   SUITE=regression      also 11 labour entry and its cost per currency
#                         (project manager) and 12 partial acceptance of a
#                         delivery (site supervisor), both confirmed through
#                         the API
#   SUITE=sessions        01, then with 2-minute access tokens: 09a sign-in
#                         and restart, 13 background and foreground with an
#                         expired token, 14 weak network (an answer that
#                         arrives after the app gave up), 15 a signed-out
#                         session's token replayed (app stays signed in),
#                         16 refresh-token reuse (app signed out), 17 password
#                         reset (app signed out, old password refused, new one
#                         works, logout survives a restart)
#
# Every flow runs even if an earlier one fails, so one run shows as much as
# possible; the step fails if any flow or API check failed. Every sign-in is
# timed from both sides for the latency report printed at the end.
set -uo pipefail
: "${OUT:?}" "${SIM_UDID:?}" "${RUNNER_TEMP:?}" "${APP_PATH:?}" "${APP_BUNDLE_ID:?}"

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=runner-health.sh
. "$HERE/runner-health.sh"
# shellcheck source=api-ctl.sh
. "$HERE/api-ctl.sh"
# shellcheck disable=SC1091
. "$RUNNER_TEMP/smoke-credentials"
echo "::add-mask::$SMOKE_PASSWORD"

SUITE="${SUITE:-regression}"
TIMING="$OUT/logs/api-timing.jsonl"
mkdir -p "$OUT/maestro" "$OUT/screenshots"
# takeScreenshot writes <name>.png into the working directory.
cd "$OUT/screenshots" || exit 1

failed=""
not_shown=""
known_issues=""

# ── Helpers ───────────────────────────────────────────────────────────────────

maestro_run() {
  maestro --device "$SIM_UDID" test \
    --debug-output "$OUT/maestro/$1" --flatten-debug-output \
    -e SMOKE_EMAIL="$SMOKE_EMAIL" -e SMOKE_PASSWORD="$SMOKE_PASSWORD" \
    -e PM_EMAIL="${PM_EMAIL:-}" -e SUP_EMAIL="${SUP_EMAIL:-}" \
    -e NEW_PASSWORD="${NEW_PASSWORD:-}" \
    "$HERE/maestro/$1.yaml"
}

# run_flow <flow> [explore|known]: a failed flow fails the step, unless
# "explore" (used for what a simulator may not be able to show at all) or
# "known" (an app behaviour already being fixed in a pull request that is not
# merged yet; reported on its own line, see KNOWN_NOTE_<flow>).
run_flow() {
  local flow="$1" rc=0
  echo "::group::Maestro flow $flow"
  if maestro_run "$flow"; then
    echo "FLOW RESULT $flow: passed"
  else
    rc=1
    if [ "${2:-}" = explore ]; then
      echo "FLOW RESULT $flow: not passed (simulator-dependent, reported separately)"
      not_shown="$not_shown $flow"
    elif [ "${2:-}" = known ]; then
      echo "FLOW RESULT $flow: not passed (known app behaviour, reported separately)"
      known_issues="$known_issues $flow"
    else
      echo "FLOW RESULT $flow: FAILED"
      failed="$failed $flow"
    fi
    runner_snapshot "after $flow did not pass"
    xcrun simctl io "$SIM_UDID" screenshot "$OUT/screenshots/$flow-at-failure.png" || true
    maestro --device "$SIM_UDID" hierarchy > "$OUT/maestro/$flow-hierarchy-at-failure.json" 2>/dev/null || true
  fi
  echo "::endgroup::"
  return "$rc"
}

skip_flow() {
  echo "FLOW RESULT $1: FAILED (not run: $2)"
  failed="$failed $1"
}

# Flow 09b's documented single retry of the Deliveries tab tap: say whether it
# was needed and whether it worked, so a retry never passes unnoticed. The
# flow writes 09b-tab-retry-1-* before the retry and 09b-tab-retry-2-* only if
# the retry opened Deliveries.
report_tab_retry() {
  local first second
  first="$(find "$OUT" -name '09b-tab-retry-1-*.png' 2>/dev/null | head -n 1)"
  second="$(find "$OUT" -name '09b-tab-retry-2-*.png' 2>/dev/null | head -n 1)"
  if [ -z "$first" ]; then
    echo "TAB RETRY 09b: not needed (the first tap on the Deliveries tab opened Deliveries)"
  elif [ -n "$second" ]; then
    echo "TAB RETRY 09b: NEEDED - the first tap on the Deliveries tab was not acted on within 15 s; the one retry opened Deliveries"
    echo "::warning::Flow 09b needed its documented Deliveries tab retry (first tap not acted on; the retry worked)"
  else
    echo "TAB RETRY 09b: NEEDED - the first tap was not acted on and the retry did not open Deliveries either"
  fi
}

# check <name> <command ...>: an API-side check; a failure fails the step.
check() {
  local name="$1"
  shift
  if "$@"; then
    echo "CHECK $name: passed"
  else
    echo "CHECK $name: FAILED"
    failed="$failed $name"
    return 1
  fi
}

ci() {
  local command="$1"
  shift
  node "$HERE/ci-checks.mjs" "$command" "$RUNNER_TEMP/smoke-credentials" "$RUNNER_TEMP/fixture.json" "$@"
}

app_pid() {
  xcrun simctl spawn "$SIM_UDID" launchctl list 2>/dev/null \
    | awk -v id="UIKitApplication:$APP_BUNDLE_ID" 'index($3, id) == 1 { print $1; exit }'
}

crash_reports() {
  ls ~/Library/Logs/DiagnosticReports 2>/dev/null | grep -c "${APP_EXECUTABLE:-ConstructOS}" || true
}

# Keychain items the app owns on this simulator, per access group. Logged
# around the reinstall so the log shows whether the Keychain kept the signed-in
# user's tokens through the uninstall (then flow 05 shows the app ignores them)
# or the simulator removed them (then flow 05 shows less).
keychain_items() {
  local db="$HOME/Library/Developer/CoreSimulator/Devices/$SIM_UDID/data/Library/Keychains/keychain-2-debug.db"
  if [ -f "$db" ]; then
    sqlite3 -readonly "$db" "select 'access group ' || quote(agrp) || ': ' || count(*) from genp where agrp like '%constructos%' group by agrp;" 2>&1 || true
    echo "KEYCHAIN ITEMS for the app: $(sqlite3 -readonly "$db" "select count(*) from genp where agrp like '%constructos%';" 2>/dev/null || echo '?')"
    # Access-group names only (no item data), to check the filter above:
    # run 44285338082 counted 0 items, so it may not match how the simulator
    # stores the group of an ad-hoc signed app.
    echo "Keychain generic-password items per access group (all apps):"
    sqlite3 -readonly "$db" "select '  ' || quote(agrp) || ': ' || count(*) from genp group by agrp order by count(*) desc limit 12;" 2>&1 || true
  else
    echo "KEYCHAIN ITEMS for the app: ? (no keychain database at the expected path)"
  fi
}

# Uninstalls and reinstalls the app while flow 04's user is still signed in.
reinstall_app() {
  echo "::group::Reinstall the app (project manager still signed in)"
  case " $failed " in
    *" 04-project-manager "*) echo "::warning::Flow 04 failed, so its user may not be signed in: the reinstall check in flow 05 proves less." ;;
  esac
  echo "--- Keychain before uninstall"; keychain_items
  xcrun simctl uninstall "$SIM_UDID" "$APP_BUNDLE_ID"
  echo "--- Keychain after uninstall"; keychain_items
  xcrun simctl install "$SIM_UDID" "$APP_PATH"
  echo "Reinstalled at: $(xcrun simctl get_app_container "$SIM_UDID" "$APP_BUNDLE_ID" app)"
  echo "::endgroup::"
}

# A new install opens on the login screen whoever was signed in before (the
# app clears its Keychain session on the first launch of an install), so a
# flow that signs in does not depend on how the previous flow ended.
fresh_install() {
  echo "Fresh install ($1)"
  xcrun simctl terminate "$SIM_UDID" "$APP_BUNDLE_ID" >/dev/null 2>&1 || true
  xcrun simctl uninstall "$SIM_UDID" "$APP_BUNDLE_ID"
  xcrun simctl install "$SIM_UDID" "$APP_PATH"
}

# Sends the app to the background by opening Settings, then brings it back.
# `simctl launch` on a running app only brings it to the foreground; the pid
# it prints shows whether the process is the same one.
background_and_foreground() {
  xcrun simctl launch "$SIM_UDID" com.apple.Preferences >/dev/null 2>&1 \
    || echo "::warning::Could not open Settings to send the app to the background"
  sleep 4
  echo "App brought back to the foreground at $(now_iso): $(xcrun simctl launch "$SIM_UDID" "$APP_BUNDLE_ID" 2>&1)"
  sleep 3
}

latency_report() {
  load_sampler_stop
  echo "::group::Sign-in latency report (client and server timings)"
  if node "$HERE/latency-report.mjs" "$OUT" > "$OUT/logs/latency-report.out" 2>&1; then
    cat "$OUT/logs/latency-report.out"
    cat "$OUT/logs/latency-report.out" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
  else
    echo "::warning::The latency report could not be built"
    cat "$OUT/logs/latency-report.out" || true
  fi
  echo "::endgroup::"
}

# ── Regression suite (flows 01 to 05) ─────────────────────────────────────────

# Latency control: the same API login, made with curl, while the test driver
# does what it does during a sign-in (asks for the screen tree over and over)
# and again after it has gone. No app request is involved, so any slowdown
# here cannot come from the app.
#
# polling_control <A|B> <what differs>. Round B repeats round A with the
# job's own `log stream` of the app stopped: in run 44432016833 `log` and the
# two diagnosticd processes that feed it were among the busiest processes
# while logins waited, and this shows how much of the slowdown they explain.
polling_control() {
  echo "::group::Latency control $1 ($2): curl logins while the test driver polls the screen"
  log_writers "before control $1"
  ( maestro_run 00-control-polling > "$OUT/logs/control-polling-$1.log" 2>&1 ) &
  local driver=$! i=0
  while kill -0 "$driver" 2>/dev/null && [ "$i" -lt 30 ]; do
    i=$((i + 1))
    api_probe "control $1 $i, test driver session running ($2)"
    sleep 3
  done
  # The control must never hold the job up: give the driver 90 s more, then stop it.
  i=0
  while kill -0 "$driver" 2>/dev/null && [ "$i" -lt 30 ]; do
    i=$((i + 1))
    sleep 3
  done
  if kill -0 "$driver" 2>/dev/null; then
    echo "::warning::Control flow $1 was still running and was stopped"
    pkill -f "00-control-polling" 2>/dev/null || true
    kill "$driver" 2>/dev/null || true
  fi
  wait "$driver"
  echo "Control flow $1 ended with status $?"
  for i in 1 2 3; do
    sleep 3
    api_probe "control $1 idle $i, no test driver ($2)"
  done
  echo "::endgroup::"
}

# The stream launch.sh started (same command, appending), and its stop.
app_log_stream_stop() {
  pkill -f "log stream --level info --style compact --predicate" 2>/dev/null || true
  sleep 2
  echo "App log stream stopped at $(now_iso); matching processes left: $(pgrep -f "log stream --level info --style compact --predicate" 2>/dev/null | wc -l | tr -d ' ')"
}

app_log_stream_start() {
  nohup xcrun simctl spawn "$SIM_UDID" log stream --level info --style compact \
    --predicate "process == \"${APP_EXECUTABLE:-ConstructOS}\"" >> "$OUT/logs/simulator-app.log" 2>&1 &
  echo "App log stream started again at $(now_iso)"
}

# The simulator's push daemon. In run 44535956687 it wrote 1400 to 4250 log
# lines a second, which keeps two diagnosticd processes busy all the time.
# Pausing it (SIGSTOP, resumed afterwards) for one control round shows how
# much of the slowdown under polling that log traffic explains.
sim_apsd_pids() { pgrep -f "simruntime.*ApplePushService.framework/apsd" 2>/dev/null; }

sim_apsd_signal() {
  local pid n=0
  for pid in $(sim_apsd_pids); do
    if kill "-$1" "$pid" 2>/dev/null; then n=$((n + 1)); fi
  done
  echo "Simulator apsd processes sent SIG$1 at $(now_iso): $n"
}

regression_suite() {
  local flow
  for flow in $1; do
    if [ "$flow" != 01-launch ]; then
      wait_for_fast_api "$flow" || true
    fi
    run_flow "$flow"
    if [ "$flow" != 01-launch ]; then
      api_probe "after $flow"
    fi
    if [ "$flow" = 01-launch ]; then
      # What the login screen exposes to the test driver, for maintaining the selectors.
      maestro --device "$SIM_UDID" hierarchy > "$OUT/maestro/login-screen-hierarchy.json" 2>/dev/null || true
    fi
    if [ "$flow" = 04-project-manager ]; then
      reinstall_app
    fi
  done
}

# ── Operations suite (flows 06 to 10) ─────────────────────────────────────────

pdf_flows() {
  local since crashes pid
  since="$(now_iso)"
  crashes="$(crash_reports)"
  fresh_install "06: the project manager signs in on a new install"
  wait_for_fast_api 06a-pdf-sign-in || true
  if run_flow 06a-pdf-sign-in; then
    echo "Leaving the simulator alone for 20 s: this sign-in runs without the test driver polling the screen"
    sleep 20
    run_flow 06b-pdf-report
  else
    skip_flow 06b-pdf-report "the sign-in before it failed"
  fi
  api_probe "after 06b-pdf-report"
  check pdf-report-served ci served --log "$TIMING" --since "$since" \
    --method GET --path '/api/v1/reports/labour$' --status 200 --ctype application/pdf
  run_flow 06c-pdf-drawing
  # Uploaded files are served without a content type of their own
  # (application/octet-stream); the app names the download .pdf itself.
  check pdf-drawing-served ci served --log "$TIMING" --since "$since" \
    --method GET --path '^/uploads/drawings/' --status 200
  pid="$(app_pid)"
  echo "App process after the PDF flows: ${pid:-none}; crash reports for the app: $(crash_reports) (before: $crashes)"
  check pdf-no-crash test -n "$pid" -a "$(crash_reports)" = "$crashes"
}

delivery_flows() {
  local since crashes
  since="$(now_iso)"
  crashes="$(crash_reports)"
  fresh_install "07: the site supervisor signs in on a new install"
  wait_for_fast_api 07a-delivery-sign-in || true
  if run_flow 07a-delivery-sign-in; then
    echo "Leaving the simulator alone for 20 s: this sign-in runs without the test driver polling the screen"
    sleep 20
    run_flow 07b-delivery-photo
  else
    skip_flow 07b-delivery-photo "the sign-in before it failed"
  fi
  api_probe "after 07b-delivery-photo"
  check delivery-saved-once ci delivery-check --supplier "Simulator Photo Check Ltd" \
    --expect 1 --photos 0 --received-by-supervisor yes
  check delivery-one-request ci served --log "$TIMING" --since "$since" \
    --method POST --path '/deliveries$' --status 201 --count 1
  check delivery-no-photo-request ci served --log "$TIMING" --since "$since" \
    --method POST --path '/photos$' --status any --count 0
  echo "Crash reports for the app: $(crash_reports) (before: $crashes)"
  check delivery-no-crash test "$(crash_reports)" = "$crashes"

  # The upload itself cannot be made by the app here (no camera, and the app
  # has no photo-library picker). Prove the endpoint contract the app relies
  # on with a real JPEG made on this runner from a simulator screenshot.
  echo "::group::Photo upload contract (API only)"
  if xcrun simctl io "$SIM_UDID" screenshot "$RUNNER_TEMP/contract.png" >/dev/null 2>&1 \
     && sips -s format jpeg -s formatOptions 80 "$RUNNER_TEMP/contract.png" --out "$RUNNER_TEMP/contract-photo.jpg" >/dev/null 2>&1; then
    check upload-contract ci upload-contract --image "$RUNNER_TEMP/contract-photo.jpg"
  else
    echo "CHECK upload-contract: FAILED (no JPEG could be made on this runner)"
    failed="$failed upload-contract"
  fi
  echo "::endgroup::"
}

offline_flows() {
  local since pid_before pid_after
  since="$(now_iso)"
  wait_for_fast_api 08a-offline-prepare || true
  if ! run_flow 08a-offline-prepare; then
    skip_flow 08b-offline-queue "the form could not be prepared"
    skip_flow 08c-offline-after "the form could not be prepared"
    return
  fi
  check offline-nothing-before ci labour-count --expect 0

  echo "::group::Outage: stop the API"
  api_stop
  echo "Outage began at $(now_iso); GET /health now gives HTTP $(curl -s -o /dev/null -m 5 -w '%{http_code}' "$API_ORIGIN/health" || true) (000 = no connection)"
  echo "::endgroup::"
  local queued=0
  run_flow 08b-offline-queue || queued=1
  echo "::group::Outage over: start the API"
  if ! api_start; then
    echo "::error::The API did not come back after the outage"
    failed="$failed api-restart-after-outage"
  fi
  echo "Outage ended at $(now_iso)"
  echo "::endgroup::"
  if [ "$queued" != 0 ]; then
    echo "::warning::The app did not report the entry as saved offline; see the screenshot of 08b. The reconnection checks are skipped."
    skip_flow 08c-offline-after "nothing was queued"
    return
  fi

  # The app is still in the foreground and has not been told anything: the
  # queue is sent only when it returns to the foreground.
  if ci labour-count --expect 0 --hold 9; then
    echo "API is back and the app is untouched: the entry has not been sent yet"
  else
    echo "::notice::The queued entry was sent before the app was sent to the background"
  fi
  pid_before="$(app_pid)"
  background_and_foreground
  check offline-arrived ci labour-count --expect 1 --wait 60
  background_and_foreground
  check offline-exactly-once ci labour-count --expect 1 --hold 15
  pid_after="$(app_pid)"
  echo "App process before the first return to the foreground: ${pid_before:-none}; after the second: ${pid_after:-none}"
  check offline-same-process test -n "$pid_before" -a "$pid_before" = "$pid_after"
  check offline-one-request ci served --log "$TIMING" --since "$since" \
    --method POST --path '/labour$' --status any --count 1
  check offline-request-created ci served --log "$TIMING" --since "$since" \
    --method POST --path '/labour$' --status 201 --count 1
  run_flow 08c-offline-after
  api_probe "after 08c-offline-after"
}

session_flows() {
  local since
  echo "::group::Restart the API with 2-minute access tokens"
  api_stop
  if ! api_start JWT_EXPIRES_IN=120s; then
    echo "::error::The API did not start with JWT_EXPIRES_IN=120s"
    failed="$failed api-restart-short-tokens"
  fi
  echo "::endgroup::"
  since="$(now_iso)"
  fresh_install "09: the site supervisor signs in on a new install"
  wait_for_fast_api 09a-session-persist || true
  if run_flow 09a-session-persist; then
    echo "Waiting 135 s with the app open, so the access token from that sign-in (2 minutes) expires"
    sleep 135
    check delivery-created-after-expiry ci create-delivery --supplier "After Expiry Supplies"
    run_flow 09b-expiry-logout
    report_tab_retry
    check token-refresh-sequence ci status-sequence --log "$TIMING" --since "$since"
  else
    skip_flow 09b-expiry-logout "the sign-in and restart before it failed"
  fi
  echo "::group::Restart the API with the default token lifetime"
  api_stop
  if ! api_start; then
    echo "::error::The API did not restart"
    failed="$failed api-restart-default"
  fi
  echo "::endgroup::"
}

# Banner display and tap routing for a simulated push. Not APNs, not Expo's
# push service: `simctl push` hands the payload to the simulator directly.
push_flows() {
  local pusher
  echo "::group::Simulated push: allow notifications for the app"
  # The app asks for notification permission only on a real device, and
  # simctl cannot grant it; applesimutils (free, from Homebrew) can on the
  # simulators it supports. Best effort.
  export HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_CLEANUP=1 HOMEBREW_NO_ENV_HINTS=1
  if ! command -v applesimutils >/dev/null 2>&1; then
    perl -e 'alarm shift; exec @ARGV' 120 brew tap wix/brew > "$OUT/logs/applesimutils-install.log" 2>&1 || true
    # Homebrew refuses formulae from a tap it has not been told to trust
    # (run 44432016833). This runner is thrown away after the job and holds
    # no secrets.
    brew trust --formula wix/brew/applesimutils >> "$OUT/logs/applesimutils-install.log" 2>&1 || true
    perl -e 'alarm shift; exec @ARGV' 300 brew install wix/brew/applesimutils >> "$OUT/logs/applesimutils-install.log" 2>&1 || true
  fi
  if command -v applesimutils >/dev/null 2>&1; then
    echo "applesimutils: $(applesimutils --version 2>&1 | awk 'NR==1')"
    applesimutils --byId "$SIM_UDID" --bundle "$APP_BUNDLE_ID" --setPermissions notifications=YES 2>&1 | tail -n 5
    echo "PUSH: notification permission requested through applesimutils (status $?)"
    sleep 8
  else
    echo "PUSH: applesimutils could not be installed; notifications stay unauthorised for the app"
    tail -n 5 "$OUT/logs/applesimutils-install.log" 2>/dev/null || true
  fi
  # Shaped like what Expo's push service delivers for the API's notifications
  # (push.service.ts): title and body in aps.alert, the data object under "body".
  cat > "$RUNNER_TEMP/push-delivery.json" <<'JSON'
{"aps":{"alert":{"title":"Delivery recorded","body":"CI push check: binding wire received on site"},"sound":"default"},
 "body":{"notificationId":"00000000-0000-4000-8000-000000000001","type":"delivery_recorded","entityType":"delivery","entityId":"00000000-0000-4000-8000-000000000002"}}
JSON
  cat > "$RUNNER_TEMP/push-attendance.json" <<'JSON'
{"aps":{"alert":{"title":"Attendance reminder","body":"CI push check: muster roll is open"},"sound":"default"},
 "body":{"notificationId":"00000000-0000-4000-8000-000000000003","type":"attendance_reminder","entityType":"attendance","entityId":"00000000-0000-4000-8000-000000000004"}}
JSON
  echo "::endgroup::"

  # push_loop <payload> <name>: one push every 8 s; a screenshot 2 s after
  # some of them, for the record of what was on screen.
  push_loop() {
    local i
    for i in $(seq 1 24); do
      if xcrun simctl push "$SIM_UDID" "$APP_BUNDLE_ID" "$1" >/dev/null 2>&1; then
        echo "$(now_iso) simctl push accepted ($2, $i)"
      else
        echo "$(now_iso) simctl push refused ($2, $i)"
      fi >> "$OUT/logs/push.log"
      sleep 2
      case "$i" in
        8|10|12|14|16) xcrun simctl io "$SIM_UDID" screenshot "$OUT/screenshots/$2-$(printf %02d "$i").png" >/dev/null 2>&1 || true ;;
      esac
      sleep 6
    done
  }

  push_loop "$RUNNER_TEMP/push-delivery.json" push-foreground &
  pusher=$!
  if run_flow 10a-push-foreground explore; then
    echo "PUSH RESULT foreground: a tap on the banner of a simulated push opened the Deliveries screen"
    kill "$pusher" 2>/dev/null; wait "$pusher" 2>/dev/null
    push_loop "$RUNNER_TEMP/push-attendance.json" push-background &
    pusher=$!
    if run_flow 10b-push-background explore; then
      echo "PUSH RESULT background: a tap on the banner brought the app back on the Attendance screen"
    else
      echo "PUSH RESULT background: not shown on this simulator"
    fi
  else
    echo "PUSH RESULT foreground: not shown on this simulator (no tap on the banner position opened the Deliveries screen); the background case was not tried"
  fi
  kill "$pusher" 2>/dev/null; wait "$pusher" 2>/dev/null
  echo "::group::Simulated push: what was sent and what the app logged"
  echo "simctl push calls: $(grep -c accepted "$OUT/logs/push.log" 2>/dev/null || true) accepted, $(grep -c refused "$OUT/logs/push.log" 2>/dev/null || true) refused"
  LC_ALL=C grep -a -i -E "notification|apns|remote-notification" "$OUT/logs/simulator-app.log" 2>/dev/null | scrub_log | tail -n 40 > "$OUT/logs/push-app-log.txt" || true
  echo "App log lines mentioning notifications: $(wc -l < "$OUT/logs/push-app-log.txt" | tr -d ' ') (last ones in logs/push-app-log.txt)"
  tail -n 12 "$OUT/logs/push-app-log.txt" | cut -c1-260
  echo "::endgroup::"
}

# ── Business flows in the regression suite (11, 12) ──────────────────────────

# Finance visibility for the project manager, set in this runner's throwaway
# database (the API deliberately has no route for it). Only then does the
# Labour tab show rates and the cost.
grant_pm_finance() {
  local psql_bin out
  psql_bin="$(brew --prefix postgresql@16)/bin/psql"
  out="$(printf 'UPDATE users SET "canViewFinance" = true WHERE email = :%s AND role = %s;\n' "'pm_email'" "'project_manager'" \
    | "$psql_bin" -h localhost -p 5432 -U postgres -d constructos_ios_ci -v ON_ERROR_STOP=1 -v pm_email="$PM_EMAIL" 2>&1)"
  echo "Finance visibility for the project manager (runner database): $out"
  [ "$out" = "UPDATE 1" ]
}

business_flows() {
  if check pm-finance-visibility grant_pm_finance \
     && check labour-usd-setup ci labour-usd-setup; then
    fresh_install "11: the project manager signs in on a new install"
    wait_for_fast_api 11-labour-cost || true
    run_flow 11-labour-cost
    api_probe "after 11-labour-cost"
    check labour-cost ci labour-cost-check --worker-first Otieno --hours 6 --rate 2000 \
      --currency KES --expect "KES=3000,USD=20"
  else
    skip_flow 11-labour-cost "the finance visibility or the USD worker could not be set up"
  fi

  if check partial-delivery-created ci create-delivery --supplier "Partial Check Supplies"; then
    fresh_install "12: the site supervisor signs in on a new install"
    wait_for_fast_api 12-partial-delivery || true
    run_flow 12-partial-delivery
    api_probe "after 12-partial-delivery"
    check partial-acceptance ci delivery-acceptance-check --supplier "Partial Check Supplies" \
      --accepted 12 --material "Binding wire rolls" --stock 12
  else
    skip_flow 12-partial-delivery "the delivery could not be created"
  fi
}

# ── Sessions suite (flows 13 to 17) ──────────────────────────────────────────

KNOWN_NOTE_14b="on main before PF-28 the app's retry of an entry the server already saved is refused (500) and the entry stays queued until it is dropped after 5 tries; PF-28 (PR 99) marks it synced"

sessions_suite() {
  local since pid_before pid_after rest
  rest="13-background-resume 14a-weak-labour 14b-weak-queue-empty 15-ended-session-quiet 16-reuse-signed-out 17-reset-revoked"
  echo "::group::Restart the API with 2-minute access tokens"
  api_stop
  if ! api_start JWT_EXPIRES_IN=120s; then
    echo "::error::The API did not start with JWT_EXPIRES_IN=120s"
    failed="$failed api-restart-short-tokens"
  fi
  echo "::endgroup::"
  fresh_install "sessions: the site supervisor signs in on a new install"
  wait_for_fast_api 09a-session-persist || true
  if ! run_flow 09a-session-persist; then
    for f in $rest; do skip_flow "$f" "the sign-in and restart before it failed"; done
    return
  fi

  # 13: background with an expired token.
  check bg-delivery-created ci create-delivery --supplier "After Background Supplies"
  since="$(now_iso)"
  pid_before="$(app_pid)"
  xcrun simctl launch "$SIM_UDID" com.apple.Preferences >/dev/null 2>&1 \
    || echo "::warning::Could not open Settings to send the app to the background"
  echo "App sent to the background at $(now_iso); waiting 140 s (the 2-minute access token expires)"
  sleep 140
  echo "App brought back to the foreground at $(now_iso): $(xcrun simctl launch "$SIM_UDID" "$APP_BUNDLE_ID" 2>&1)"
  sleep 3
  run_flow 13-background-resume
  pid_after="$(app_pid)"
  echo "App process before the background: ${pid_before:-none}; after the flow: ${pid_after:-none}"
  check bg-same-process test -n "$pid_before" -a "$pid_before" = "$pid_after"
  check bg-token-refreshed ci refreshed --log "$TIMING" --since "$since"

  # 14: weak network, an answer that arrives after the app gave up.
  since="$(now_iso)"
  printf '%s\n' '{"id":"labour-lost-answer","method":"POST","path":"/labour$","delayMs":20000,"count":1}' \
    > "$RUNNER_TEMP/weak-network.json"
  echo "Weak network on: the API holds back its next labour answer for 20 s"
  wait_for_fast_api 14a-weak-labour || true
  if run_flow 14a-weak-labour; then
    check weak-saved-on-server ci labour-count --expect 1 --wait 30
    rm -f "$RUNNER_TEMP/weak-network.json"
    echo "Weak network off at $(now_iso)"
    check weak-answer-held-back grep -q '"ev":"delayed"' "$TIMING"
    background_and_foreground
    background_and_foreground
    check weak-no-duplicate ci labour-count --expect 1 --hold 20
    ci served --log "$TIMING" --since "$since" --method POST --path '/labour$' --status any || true
    run_flow 14b-weak-queue-empty known
  else
    rm -f "$RUNNER_TEMP/weak-network.json"
    skip_flow 14b-weak-queue-empty "nothing was kept by the app"
  fi

  # 15: a signed-out session's refresh token presented again.
  check ended-session-replay ci ended-session-replay
  since="$(now_iso)"
  echo "Waiting 135 s with the app open, so its access token expires"
  sleep 135
  run_flow 15-ended-session-quiet
  check ended-app-refreshed ci refreshed --log "$TIMING" --since "$since"

  # 16: refresh-token reuse ends every session.
  since="$(now_iso)"
  if check reuse-replay ci reuse-replay; then
    run_flow 16-reuse-signed-out
    check reuse-app-refused ci refreshed --log "$TIMING" --since "$since" --refused yes
  else
    skip_flow 16-reuse-signed-out "the reuse could not be made"
  fi

  # 17: password reset. The new password is generated here, masked, and
  # written to the credentials file only so collect.sh can mask it too.
  NEW_PASSWORD="Bb2$(openssl rand -hex 12)"
  echo "::add-mask::$NEW_PASSWORD"
  export NEW_PASSWORD
  ( umask 077; echo "SUP_NEW_PASSWORD=$NEW_PASSWORD" >> "$RUNNER_TEMP/smoke-credentials" )
  since="$(now_iso)"
  if check password-reset ci reset-password; then
    run_flow 17-reset-revoked
    check reset-app-refused ci refreshed --log "$TIMING" --since "$since" --refused yes
  else
    skip_flow 17-reset-revoked "the password could not be reset"
  fi

  echo "::group::Restart the API with the default token lifetime"
  api_stop
  if ! api_start; then
    echo "::error::The API did not restart"
    failed="$failed api-restart-default"
  fi
  echo "::endgroup::"
}

# ── Run ───────────────────────────────────────────────────────────────────────

echo "Suite: $SUITE (signing: ${SIGNING:-?}); runner clock $(now_iso), time zone offset $(date +%z), $(sysctl -n hw.ncpu) CPUs"
free_runner
log_writers "simulator booted, app launched, before the flows"
load_sampler_start
( cd "$API_REPO_ROOT/packages/api" && node "$HERE/bcrypt-bench.mjs" "after the build, simulator booted, no test driver" ) || true

if [ "${SIGNING:-}" = "disabled" ]; then
  # A build made with CODE_SIGNING_ALLOWED=NO has no keychain entitlement, so
  # secure storage fails (errSecMissingEntitlement, -34018) and sign-in cannot
  # work. Devices and store builds are always signed; this job shows that the
  # unsigned build installs, launches and reaches the login screen.
  echo "::notice::Signing disabled: launch flow only. Sign-in needs the keychain entitlement an unsigned build does not have; the adhoc jobs cover it."
  regression_suite "01-launch"
elif [ "$SUITE" = sessions ]; then
  regression_suite "01-launch"
  sessions_suite
  latency_report
elif [ "$SUITE" = operations ]; then
  regression_suite "01-launch"
  pdf_flows
  delivery_flows
  offline_flows
  session_flows
  push_flows
  latency_report
else
  regression_suite "01-launch 02-wrong-password 03-login-tabs-logout 04-project-manager 05-site-supervisor"
  echo "::group::API cross-check of the attendance written in flow 05"
  if node "$HERE/verify-writes.mjs" "$RUNNER_TEMP/smoke-credentials" "$RUNNER_TEMP/fixture.json"; then
    echo "API CROSS-CHECK: passed"
  else
    echo "API CROSS-CHECK: FAILED"
    failed="$failed api-cross-check"
  fi
  echo "::endgroup::"
  business_flows
  polling_control A "app log stream running"
  app_log_stream_stop
  polling_control B "app log stream stopped"
  sim_apsd_signal STOP
  polling_control C "app log stream stopped, simulator apsd paused"
  sim_apsd_signal CONT
  app_log_stream_start
  latency_report
fi
load_sampler_stop

if [ -n "$not_shown" ]; then
  echo "::notice::Not shown on this simulator (does not fail the job):$not_shown"
fi
for flow in $known_issues; do
  note_var="KNOWN_NOTE_${flow%%-*}"
  echo "KNOWN ISSUE $flow: ${!note_var:-see the flow file}"
  echo "::warning::Known app behaviour, not failing the job: $flow"
done
if [ -n "$failed" ]; then
  echo "::error::Smoke flows or checks failed:$failed"
  exit 1
fi
echo "All smoke flows and checks passed."
