#!/usr/bin/env bash
# Gathers the last screenshot, crash reports and log tails for the artifact,
# removes the generated password and anything token-like from what will be
# uploaded or printed, and writes the job summary. Never fails the job.
set -uo pipefail
: "${OUT:?}"

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=api-ctl.sh
. "$HERE/api-ctl.sh"

if [ -n "${SIM_UDID:-}" ]; then
  xcrun simctl io "$SIM_UDID" screenshot "$OUT/screenshots/99-final.png" 2>/dev/null || true
fi

mkdir -p "$OUT/logs/crash-reports"
cp ~/Library/Logs/DiagnosticReports/*"${APP_EXECUTABLE:-ConstructOS}"* "$OUT/logs/crash-reports/" 2>/dev/null || true
# Memory-pressure kills leave a JetsamEvent report instead of a crash report.
cp ~/Library/Logs/DiagnosticReports/JetsamEvent* "$OUT/logs/crash-reports/" 2>/dev/null || true

# The API prints account setup links (one-time tokens) outside production.
# seed-fixture.mjs used them and they die with this runner's database, but
# keep them, and anything shaped like a bearer value or a JWT, out of the
# uploaded artifact and out of the job log (scrub_log, api-ctl.sh).
for f in "$OUT/logs/api.log" "$OUT/logs/simulator-app.log"; do
  if [ -f "$f" ]; then
    scrub_log < "$f" > "$f.scrubbed" && mv "$f.scrubbed" "$f"
  fi
done

if [ -f "${RUNNER_TEMP:-/nonexistent}/smoke-credentials" ]; then
  # shellcheck disable=SC1091
  . "$RUNNER_TEMP/smoke-credentials"
  # The generated password, and the one flow 17 resets to (sessions suite).
  for secret in "${SMOKE_PASSWORD:-}" "${SUP_NEW_PASSWORD:-}"; do
    [ -n "$secret" ] || continue
    echo "::add-mask::$secret"
    LC_ALL=C grep -rlF -- "$secret" "$OUT" 2>/dev/null | while IFS= read -r f; do
      LC_ALL=C sed -i '' "s/$secret/[masked]/g" "$f"
      echo "Removed a generated password from ${f#"$OUT"/}"
    done
  done
fi

echo "--- API log (last 40 lines)"
tail -n 40 "$OUT/logs/api.log" 2>/dev/null | scrub_log || echo "(none)"
if [ -f "$OUT/logs/api-timing.jsonl" ]; then
  echo "--- API timing log: $(wc -l < "$OUT/logs/api-timing.jsonl" | tr -d ' ') lines; lines with a query string, bearer value or JWT: $(LC_ALL=C grep -c -E '[?]|Bearer |eyJ' "$OUT/logs/api-timing.jsonl" || true)"
fi
echo "--- Simulator app log (last 80 lines)"
tail -n 80 "$OUT/logs/simulator-app.log" 2>/dev/null | scrub_log || echo "(none)"
echo "--- Crash reports"
ls -l "$OUT/logs/crash-reports" 2>/dev/null || true

if [ -f "$OUT/logs/xcodebuild.log" ]; then gzip -9 "$OUT/logs/xcodebuild.log"; fi

echo "--- Artifact contents"
find "$OUT" -type f | sort | awk 'NR<=400'

{
  echo "### iOS simulator run (signing: ${SIGNING:-?}, suite: ${SUITE:-?})"
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
