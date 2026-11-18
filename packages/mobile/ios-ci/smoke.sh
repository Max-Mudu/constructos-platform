#!/usr/bin/env bash
# Drives the installed app with Maestro against the API on this runner:
# login screen, wrong-password error, company admin tabs and logout, project
# manager tabs with API data, reinstall while signed in, site supervisor tabs
# with API data plus an attendance record and check-out, logout. Then confirms
# the attendance writes through the API.
# Every flow runs even if an earlier one fails, so one run shows as much as
# possible; the step fails if any flow or the API cross-check failed.
set -uo pipefail
: "${OUT:?}" "${SIM_UDID:?}" "${RUNNER_TEMP:?}" "${APP_PATH:?}" "${APP_BUNDLE_ID:?}"

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=runner-health.sh
. "$HERE/runner-health.sh"
# shellcheck disable=SC1091
. "$RUNNER_TEMP/smoke-credentials"
echo "::add-mask::$SMOKE_PASSWORD"

mkdir -p "$OUT/maestro" "$OUT/screenshots"
# takeScreenshot writes <name>.png into the working directory.
cd "$OUT/screenshots" || exit 1

failed=""

# Keychain items the app owns on this simulator, per access group. Logged
# around the reinstall so the log shows whether the Keychain kept the signed-in
# user's tokens through the uninstall (then flow 05 shows the app ignores them)
# or the simulator removed them (then flow 05 shows less).
keychain_items() {
  local db="$HOME/Library/Developer/CoreSimulator/Devices/$SIM_UDID/data/Library/Keychains/keychain-2-debug.db"
  if [ -f "$db" ]; then
    sqlite3 -readonly "$db" "select 'access group ' || quote(agrp) || ': ' || count(*) from genp where agrp like '%constructos%' group by agrp;" 2>&1 || true
    echo "KEYCHAIN ITEMS for the app: $(sqlite3 -readonly "$db" "select count(*) from genp where agrp like '%constructos%';" 2>/dev/null || echo '?')"
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

flows="01-launch 02-wrong-password 03-login-tabs-logout 04-project-manager 05-site-supervisor"
if [ "${SIGNING:-}" = "disabled" ]; then
  # A build made with CODE_SIGNING_ALLOWED=NO has no keychain entitlement, so
  # secure storage fails (errSecMissingEntitlement, -34018) and sign-in cannot
  # work. Devices and store builds are always signed; this job shows that the
  # unsigned build installs, launches and reaches the login screen.
  flows="01-launch"
  echo "::notice::Signing disabled: launch flow only. Sign-in needs the keychain entitlement an unsigned build does not have; the adhoc job covers it."
fi
free_runner
for flow in $flows; do
  if [ "$flow" != 01-launch ]; then
    wait_for_fast_api "$flow" || true
  fi
  echo "::group::Maestro flow $flow"
  if maestro --device "$SIM_UDID" test \
       --debug-output "$OUT/maestro/$flow" --flatten-debug-output \
       -e SMOKE_EMAIL="$SMOKE_EMAIL" -e SMOKE_PASSWORD="$SMOKE_PASSWORD" \
       -e PM_EMAIL="${PM_EMAIL:-}" -e SUP_EMAIL="${SUP_EMAIL:-}" \
       "$HERE/maestro/$flow.yaml"; then
    echo "FLOW RESULT $flow: passed"
  else
    echo "FLOW RESULT $flow: FAILED"
    failed="$failed $flow"
    runner_snapshot "after $flow failed"
    xcrun simctl io "$SIM_UDID" screenshot "$OUT/screenshots/$flow-at-failure.png" || true
    maestro --device "$SIM_UDID" hierarchy > "$OUT/maestro/$flow-hierarchy-at-failure.json" 2>/dev/null || true
  fi
  if [ "$flow" = 01-launch ]; then
    # What the login screen exposes to the test driver, for maintaining the selectors.
    maestro --device "$SIM_UDID" hierarchy > "$OUT/maestro/login-screen-hierarchy.json" 2>/dev/null || true
  fi
  echo "::endgroup::"
  if [ "$flow" = 04-project-manager ]; then
    reinstall_app
  fi
done

if [ "${SIGNING:-}" != "disabled" ]; then
  echo "::group::API cross-check of the attendance written in flow 05"
  if node "$HERE/verify-writes.mjs" "$RUNNER_TEMP/smoke-credentials" "$RUNNER_TEMP/fixture.json"; then
    echo "API CROSS-CHECK: passed"
  else
    echo "API CROSS-CHECK: FAILED"
    failed="$failed api-cross-check"
  fi
  echo "::endgroup::"
fi

if [ -n "$failed" ]; then
  echo "::error::Smoke flows failed:$failed"
  exit 1
fi
echo "All smoke flows passed."
