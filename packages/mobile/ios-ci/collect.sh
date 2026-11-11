#!/usr/bin/env bash
# Gathers the last screenshot, crash reports and log tails for the artifact,
# removes the generated password from anything that will be uploaded and
# writes the job summary. Never fails the job.
set -uo pipefail
: "${OUT:?}"

if [ -n "${SIM_UDID:-}" ]; then
  xcrun simctl io "$SIM_UDID" screenshot "$OUT/screenshots/99-final.png" 2>/dev/null || true
fi

mkdir -p "$OUT/logs/crash-reports"
cp ~/Library/Logs/DiagnosticReports/*"${APP_EXECUTABLE:-ConstructOS}"* "$OUT/logs/crash-reports/" 2>/dev/null || true

if [ -f "${RUNNER_TEMP:-/nonexistent}/smoke-credentials" ]; then
  # shellcheck disable=SC1091
  . "$RUNNER_TEMP/smoke-credentials"
  echo "::add-mask::$SMOKE_PASSWORD"
  LC_ALL=C grep -rlF -- "$SMOKE_PASSWORD" "$OUT" 2>/dev/null | while IFS= read -r f; do
    LC_ALL=C sed -i '' "s/$SMOKE_PASSWORD/[masked]/g" "$f"
    echo "Removed the generated password from ${f#"$OUT"/}"
  done
fi

echo "--- API log (last 40 lines)"
tail -n 40 "$OUT/logs/api.log" 2>/dev/null || echo "(none)"
echo "--- Simulator app log (last 80 lines)"
tail -n 80 "$OUT/logs/simulator-app.log" 2>/dev/null || echo "(none)"
echo "--- Crash reports"
ls -l "$OUT/logs/crash-reports" 2>/dev/null || true

if [ -f "$OUT/logs/xcodebuild.log" ]; then gzip -9 "$OUT/logs/xcodebuild.log"; fi

echo "--- Artifact contents"
find "$OUT" -type f | sort | awk 'NR<=300'

{
  echo "### iOS simulator run (signing: ${SIGNING:-?})"
  echo
  echo "| | |"
  echo "|---|---|"
  echo "| macOS | $(sw_vers -productVersion) ($(uname -m)) |"
  echo "| Xcode | $(xcodebuild -version | tr '\n' ' ') |"
  echo "| Simulator | ${SIM_NAME:-not picked}, iOS ${SIM_RUNTIME:-?} |"
  echo "| App built | $([ -n "${APP_PATH:-}" ] && echo yes || echo no) |"
  echo "| API URL in the bundle | ${EXPO_PUBLIC_API_URL:-?} |"
  echo "| HTTP to localhost allowed by Info.plist | ${ATS_LOCALHOST_HTTP:-not checked} |"
  echo "| Screenshots | $(find "$OUT/screenshots" -name '*.png' | wc -l | tr -d ' ') |"
} >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
exit 0
