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
for flow in 01-launch 02-wrong-password 03-login-tabs-logout; do
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
  echo "::endgroup::"
done

if [ -n "$failed" ]; then
  echo "::error::Smoke flows failed:$failed"
  exit 1
fi
echo "All smoke flows passed."
