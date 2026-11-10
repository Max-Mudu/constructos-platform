#!/usr/bin/env bash
# Verifies which API URL was inlined into the built JS bundle and whether the
# built Info.plist allows plain HTTP to localhost (needed for the smoke test).
set -euo pipefail
: "${OUT:?}" "${APP_PATH:?}" "${EXPO_PUBLIC_API_URL:?}"

BUNDLE="$APP_PATH/main.jsbundle"
if [ ! -f "$BUNDLE" ]; then
  echo "::error::No main.jsbundle in the built app"
  find "$APP_PATH" -maxdepth 2 \( -name '*.jsbundle' -o -name '*.hbc' \) -print
  exit 1
fi
ls -l "$BUNDLE"
file "$BUNDLE" || true

echo "--- http(s) origins in the JS bundle (count, origin)"
LC_ALL=C grep -a -o -E 'https?://[A-Za-z0-9._-]+(:[0-9]+)?(/api/v1)?' "$BUNDLE" \
  | sort | uniq -c | sort -rn | awk 'NR<=80' | tee "$OUT/logs/bundle-urls.txt" || true

if LC_ALL=C grep -a -q -F 'railway.app' "$BUNDLE"; then
  echo "::error::The JS bundle mentions railway.app. This build must only use the API on this runner."
  exit 1
fi
if ! LC_ALL=C grep -a -q -F "$EXPO_PUBLIC_API_URL" "$BUNDLE"; then
  echo "::error::$EXPO_PUBLIC_API_URL is not in the JS bundle, so EXPO_PUBLIC_API_URL was not inlined."
  exit 1
fi
echo "API URL in the built JS bundle: $EXPO_PUBLIC_API_URL"
echo "No railway.app host in the built JS bundle."

echo "--- App Transport Security in the built Info.plist"
ATS_JSON="$(plutil -extract NSAppTransportSecurity json -o - "$APP_PATH/Info.plist" 2>/dev/null || echo '{}')"
echo "$ATS_JSON" | tee "$OUT/logs/ats.json"
echo
ALLOWED="$(echo "$ATS_JSON" | jq -r '(.NSAllowsArbitraryLoads == true) or (.NSAllowsLocalNetworking == true) or (.NSExceptionDomains.localhost.NSExceptionAllowsInsecureHTTPLoads == true)')"
echo "ATS_LOCALHOST_HTTP=$ALLOWED" >> "$GITHUB_ENV"
if [ "$ALLOWED" = true ]; then
  echo "Plain HTTP to localhost is allowed by the generated Info.plist."
else
  # Deliberately not fixed here: loosening transport security is an app
  # configuration decision. The smoke test is skipped and the job fails.
  echo "::error::The generated Info.plist does not allow plain HTTP to localhost. The smoke test is skipped."
fi
