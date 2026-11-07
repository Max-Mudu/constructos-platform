# ConstructOS mobile: local Android test APK (no EAS cloud)

Last verified: 2026-11-07 on Windows 11, Expo SDK 51 / React Native 0.74.5, against a local API.

This builds an installable, release-mode APK on a developer machine for **local emulator or
USB testing only**. It costs nothing and needs no Expo account. It is not a store build and it
must not be distributed to testers when it allows cleartext HTTP (see step 4).

For tester phones, use an HTTPS API (see `DEV-API-ACCESS.md`) and an EAS `preview` build or this
recipe without the cleartext change.

## Rules

- **Never commit the generated native project.** `npx expo prebuild` writes `android/` and edits
  `package.json` scripts. Run it in a throwaway copy of `packages/mobile`, not in the package
  itself. The repository keeps the managed (no `android/`) workflow.
- Never commit APKs, keystores or signing passwords (`*.keystore` and `*.jks` are ignored).
- The template signs release builds with the public Android **debug** keystore. That is fine for
  local installs; it is not an upload key.

## Prerequisites

- Node and the repo dependencies installed (`npm ci` at the repo root).
- Android SDK (`%LOCALAPPDATA%\Android\Sdk`) with platform 34, build-tools 34, an NDK and CMake.
- JDK 17 or 21. Android Studio's bundled JBR works:
  `JAVA_HOME="C:\Program Files\Android\Android Studio\jbr"`.
- About 3 GB of free RAM for Gradle (close the emulator during the build on small machines) and
  a few GB of disk for the Gradle cache.

## Steps

Paths are relative to the repo root. Use a short path for the copy: native C++ builds on
Windows fail with very long paths.

1. **Copy the app into a scratch folder** next to `packages/mobile`, so Node resolution still
   finds the hoisted root `node_modules`:

   ```bash
   mkdir packages/mob-apk
   cp -r packages/mobile/{app,assets,src,app.json,babel.config.js,global.css,package.json,tailwind.config.js,tsconfig.json} packages/mob-apk/
   # optional: rename the copy's package.json "name" so it does not clash with @constructos/mobile
   ```

2. **Generate the native project in the copy:**

   ```bash
   cd packages/mob-apk
   CI=1 npx expo prebuild --platform android --no-install
   ```

3. **Optional build-speed tweaks** in `packages/mob-apk/android`:
   - `gradle.properties`: `reactNativeArchitectures=x86_64` for emulator-only APKs, or
     `arm64-v8a` for a modern phone (default builds all four ABIs and is much slower/larger).
     **An APK built for one ABI only works on that ABI.** The prebuilt React Native and Hermes
     libraries are still packaged for all four ABIs, but the libraries compiled locally
     (`expo-modules-core`, `reanimated`, `rnscreens`) exist only for the selected one (checked
     by listing the APK contents), so an x86_64-only APK is missing them on an arm64 phone and
     cannot run there. Build `arm64-v8a` (or the default) for phones.
   - `build.gradle`: if Gradle tries to download `ndkVersion "26.1.10909125"`, you can point it
     at an installed NDK 26.x instead.

4. **Local HTTP only — allow cleartext.** Android blocks plain HTTP in release builds. For a
   build that talks to `http://10.0.2.2:3001` (emulator → host) or a LAN IP, add
   `android:usesCleartextTraffic="true"` to the `<application>` element of
   `android/app/src/main/AndroidManifest.xml` **in the scratch copy only**. Skip this step when
   the API URL is `https://`.

   The committed, repeatable way to do the same thing is the `expo-build-properties` config
   plugin (`android.usesCleartextTraffic`), which is a new dependency and should be added only to
   a dedicated development/test build profile, never to production.

5. **Build** (the API URL is baked into the JS bundle at this point):

   ```bash
   cd packages/mob-apk/android
   export JAVA_HOME="C:\Program Files\Android\Android Studio\jbr"
   EXPO_PUBLIC_API_URL=http://10.0.2.2:3001/api/v1 NODE_ENV=production ./gradlew assembleRelease
   ```

   Output: `android/app/build/outputs/apk/release/app-release.apk`.

6. **Install and run:**

   ```bash
   adb install -r android/app/build/outputs/apk/release/app-release.apk
   adb shell monkey -p com.constructos.app -c android.intent.category.LAUNCHER 1
   ```

   For a USB phone, either build with the machine's LAN IP, or build with
   `http://localhost:3001/api/v1` and run `adb reverse tcp:3001 tcp:3001`.

7. **Clean up:** delete `packages/mob-apk` when done (it is not tracked; do not `git add` it).

## Reference results (SDK 51, 2026-11-07)

- Cold first build: about 45 minutes on a 16 GB Windows laptop (Gradle, Kotlin and C++
  compilation, dependency downloads); later builds are incremental.
- `app-release.apk` (x86_64 native code, debug-signed): 66.7 MB, of which about 54 MB is native
  libraries. `targetSdkVersion` 34, `minSdkVersion` 23.
- Smoke test passed on Android 14 (API 34) and Android 16 (API 36) emulators.

## Notes for newer Expo SDKs

- Newer React Native versions raise the required Android SDK pieces (for example
  `compileSdk 37`, build-tools 37 and NDK 27.1 for React Native 0.88, with Gradle 9). Install
  them up front with `sdkmanager` (Android Studio → SDK Manager) to avoid long downloads in the
  middle of the build. Read the versions from
  `node_modules/react-native/gradle/libs.versions.toml`.
- On Windows, do **not** make the scratch project's own `node_modules` a directory junction or
  symlink to another checkout: `expo prebuild` then appeared to hang (100% CPU in a file-system
  glob that follows links). A real copy of that folder works; a junction for the repo-root
  `node_modules` was fine.
- Gradle needs about 3 GB of RAM on top of whatever else is running. Do not run it alongside an
  emulator, Metro and other heavy jobs on a 16 GB machine.

## SDK 58 on Windows: the 260-character path limit (2026-11-07)

SDK 58 compiles more native code locally (`react-native-worklets` and the app's generated
codegen libraries, such as `react-native-gesture-handler`'s). On Windows with long paths
**disabled** (`HKLM\SYSTEM\CurrentControlSet\Control\FileSystem\LongPathsEnabled` = 0), the
SDK 58 release build fails in `:app:buildCMakeRelWithDebInfo` with
`ninja: error: Stat(...RNGestureHandlerDetectorShadowNode.cpp.o): Filename longer than 260 characters`.
Memory was not the problem: the build stayed within about 3 GB.

What did **not** fix it:
- moving the project to a short root such as `C:\b5`;
- pointing every module's CMake staging directory at `C:\cx\<module>`;
- passing `-DCMAKE_OBJECT_PATH_MAX=128`.

The object path still embeds the full source path under `node_modules`.

Routes that avoid the limit, in order of preference:

1. **EAS Build (cloud, Linux):** no Windows path limit. Expo's free plan includes a monthly
   allowance of low-priority Android builds. It needs an Expo account login (an owner step) and
   an `eas.json` profile with `android.buildType: "apk"`.
2. **Enable Windows long paths** (an administrator change). Set `LongPathsEnabled` to 1, then
   sign out and back in. It may also need a newer CMake/ninja from `sdkmanager` (for example
   CMake 3.31+), because older ninja builds ignore the setting.
3. **Build inside WSL2 (Ubuntu)** with the Linux Android SDK. This needs no path workaround,
   but setup takes longer.

## Smoke test checklist

1. Wrong password → "Invalid email or password".
2. Correct login → "My Day" dashboard.
3. Deliveries, Attendance and Schedule tabs load.
4. Force-stop and relaunch → still signed in.
5. Profile → Log Out → login screen; relaunch → still signed out.
