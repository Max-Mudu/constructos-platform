#!/usr/bin/env bash
# Installs the built app in the booted simulator, launches it, waits and takes
# screenshots. Fails if the app process is gone 45 s after launch.
set -euo pipefail
: "${OUT:?}" "${APP_PATH:?}" "${APP_EXECUTABLE:?}" "${SIM_UDID:?}" "${APP_BUNDLE_ID:?}"

echo "Waiting for ${SIM_NAME:-the simulator} (iOS ${SIM_RUNTIME:-?}) to finish booting"
xcrun simctl bootstatus "$SIM_UDID" -b

xcrun simctl install "$SIM_UDID" "$APP_PATH"
echo "Installed at: $(xcrun simctl get_app_container "$SIM_UDID" "$APP_BUNDLE_ID" app)"

nohup xcrun simctl spawn "$SIM_UDID" log stream --level info --style compact \
  --predicate "process == \"$APP_EXECUTABLE\"" > "$OUT/logs/simulator-app.log" 2>&1 &

LAUNCH="$(xcrun simctl launch "$SIM_UDID" "$APP_BUNDLE_ID")"
echo "simctl launch: $LAUNCH"
APP_PID="${LAUNCH##*: }"

sleep 20
xcrun simctl io "$SIM_UDID" screenshot "$OUT/screenshots/00-launch-20s.png"
sleep 25
xcrun simctl io "$SIM_UDID" screenshot "$OUT/screenshots/00-launch-45s.png"

if kill -0 "$APP_PID" 2>/dev/null; then
  echo "App process $APP_PID ($APP_EXECUTABLE) is still running 45 s after launch."
else
  echo "::error::App process $APP_PID ($APP_EXECUTABLE) is not running 45 s after launch."
  ls ~/Library/Logs/DiagnosticReports/ 2>/dev/null || true
  exit 1
fi
