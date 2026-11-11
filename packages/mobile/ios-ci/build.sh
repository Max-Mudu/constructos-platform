#!/usr/bin/env bash
# Release build for the iOS Simulator. Run from packages/mobile/ios after
# `expo prebuild` and `pod install`. No Apple signing identity is used.
set -euo pipefail
: "${OUT:?}" "${SIM_UDID:?}" "${EXPO_PUBLIC_API_URL:?}"

WORKSPACE="$(ls -d ./*.xcworkspace | awk 'NR==1')"
SCHEME="$(basename "$WORKSPACE" .xcworkspace)"

case "${SIGNING:-disabled}" in
  disabled) SIGN_ARGS=(CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY=) ;;
  adhoc)    SIGN_ARGS=(CODE_SIGN_IDENTITY=- CODE_SIGNING_REQUIRED=NO) ;;
  *) echo "Unknown SIGNING value: ${SIGNING}"; exit 2 ;;
esac

if command -v xcbeautify >/dev/null 2>&1; then FORMAT=(xcbeautify); else FORMAT=(cat); fi

echo "Workspace: $WORKSPACE  Scheme: $SCHEME  Configuration: Release  SDK: iphonesimulator"
echo "Signing: ${SIGNING:-disabled} (${SIGN_ARGS[*]})"
echo "Xcode: $(xcodebuild -version | tr '\n' ' ')"
echo "Destination: ${SIM_NAME:-?} (iOS ${SIM_RUNTIME:-?}) $SIM_UDID"
echo "EXPO_PUBLIC_API_URL for the bundle: $EXPO_PUBLIC_API_URL"

START="$(date +%s)"
status=0
# EXPO_PUBLIC_API_URL is passed both in the environment and as a build setting,
# so the "Bundle React Native code and images" phase sees it either way.
xcodebuild \
  -workspace "$WORKSPACE" \
  -scheme "$SCHEME" \
  -configuration Release \
  -sdk iphonesimulator \
  -destination "id=$SIM_UDID" \
  -derivedDataPath "$PWD/build" \
  ONLY_ACTIVE_ARCH=YES \
  COMPILER_INDEX_STORE_ENABLE=NO \
  "EXPO_PUBLIC_API_URL=$EXPO_PUBLIC_API_URL" \
  "${SIGN_ARGS[@]}" \
  build 2>&1 | tee "$OUT/logs/xcodebuild.log" | "${FORMAT[@]}" || status=$?
echo "xcodebuild finished with status $status after $(( $(date +%s) - START )) s"

if [ "$status" != 0 ]; then
  echo "::error::xcodebuild failed (status $status)"
  echo "--- error lines from the raw log"
  grep -n -E "error:|fatal error|BUILD FAILED|The following build commands failed" -A 3 "$OUT/logs/xcodebuild.log" | awk 'NR<=250' || true
  echo "--- last 60 lines of the raw log"
  tail -n 60 "$OUT/logs/xcodebuild.log" || true
  exit "$status"
fi

APP_PATH="$(ls -d "$PWD"/build/Build/Products/Release-iphonesimulator/*.app | awk 'NR==1')"
EXECUTABLE="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$APP_PATH/Info.plist")"
echo "APP_PATH=$APP_PATH" >> "$GITHUB_ENV"
echo "APP_EXECUTABLE=$EXECUTABLE" >> "$GITHUB_ENV"

echo "Built app: $APP_PATH ($(du -sh "$APP_PATH" | awk '{print $1}'))"
for key in CFBundleIdentifier CFBundleShortVersionString CFBundleVersion MinimumOSVersion DTXcode DTXcodeBuild DTSDKName DTPlatformName; do
  echo "  $key = $(/usr/libexec/PlistBuddy -c "Print :$key" "$APP_PATH/Info.plist" 2>/dev/null || echo '(unset)')"
done
echo "  architectures = $(lipo -archs "$APP_PATH/$EXECUTABLE" 2>/dev/null || echo '?')"
echo "--- code signature (none expected when signing is disabled, ad hoc otherwise)"
codesign -dv "$APP_PATH" 2>&1 | awk 'NR<=12' || true
echo "--- entitlements sections in the executable"
otool -l "$APP_PATH/$EXECUTABLE" | grep -c "__entitlements" || true
