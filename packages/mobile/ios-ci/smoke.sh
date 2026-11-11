#!/usr/bin/env bash
# Drives the installed app with Maestro against the API on this runner:
# login screen, wrong-password error, login, main tabs, logout.
# Every flow runs even if an earlier one fails, so one run shows as much as
# possible; the step fails if any flow failed.
set -uo pipefail
: "${OUT:?}" "${SIM_UDID:?}" "${RUNNER_TEMP:?}"

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
. "$RUNNER_TEMP/smoke-credentials"
echo "::add-mask::$SMOKE_PASSWORD"

mkdir -p "$OUT/maestro" "$OUT/screenshots"
# takeScreenshot writes <name>.png into the working directory.
cd "$OUT/screenshots" || exit 1

failed=""
flows="01-launch 02-wrong-password 03-login-tabs-logout"
if [ "${SIGNING:-}" = "disabled" ]; then
  # A build made with CODE_SIGNING_ALLOWED=NO has no keychain entitlement, so
  # secure storage fails (errSecMissingEntitlement, -34018) and sign-in cannot
  # work. Devices and store builds are always signed; this job shows that the
  # unsigned build installs, launches and reaches the login screen.
  flows="01-launch"
  echo "::notice::Signing disabled: launch flow only. Sign-in needs the keychain entitlement an unsigned build does not have; the adhoc job covers it."
fi
for flow in $flows; do
  echo "::group::Maestro flow $flow"
  if maestro --device "$SIM_UDID" test \
       --debug-output "$OUT/maestro/$flow" --flatten-debug-output \
       -e SMOKE_EMAIL="$SMOKE_EMAIL" -e SMOKE_PASSWORD="$SMOKE_PASSWORD" \
       "$HERE/maestro/$flow.yaml"; then
    echo "FLOW RESULT $flow: passed"
  else
    echo "FLOW RESULT $flow: FAILED"
    failed="$failed $flow"
    xcrun simctl io "$SIM_UDID" screenshot "$OUT/screenshots/$flow-at-failure.png" || true
    maestro --device "$SIM_UDID" hierarchy > "$OUT/maestro/$flow-hierarchy-at-failure.json" 2>/dev/null || true
  fi
  if [ "$flow" = 01-launch ]; then
    # What the login screen exposes to the test driver, for maintaining the selectors.
    maestro --device "$SIM_UDID" hierarchy > "$OUT/maestro/login-screen-hierarchy.json" 2>/dev/null || true
  fi
  echo "::endgroup::"
done

if [ -n "$failed" ]; then
  echo "::error::Smoke flows failed:$failed"
  exit 1
fi
echo "All smoke flows passed."
