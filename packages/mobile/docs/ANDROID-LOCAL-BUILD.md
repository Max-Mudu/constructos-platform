# ConstructOS mobile: local Android test APK (no EAS cloud)

Last verified: 2026-11-07 on Windows 11. First written for Expo SDK 51 / React Native 0.74.5. The
SDK 58 / React Native 0.88 emulator build and the physical-phone plan are in the last three
sections ("SDK 58 reference build", "Physical Android phone build plan" and "Release signing").

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
     **On SDK 58 the filter applies to every native library**, prebuilt ones included: the
     SDK 58 x86_64 APK contains 25 libraries, all under `lib/x86_64/` and none for any other
     ABI (see "SDK 58 reference build" below).
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

**Resolved later on 2026-11-07 by route 2.** With `LongPathsEnabled` = 1 (after signing out and
in) and every native module built with **CMake 3.31.6**, whose bundled **ninja 1.12.1** honours
Windows long paths, the SDK 58 release build succeeded. The SDK's default CMake 3.22.1 ships
ninja 1.10.2, which ignores the setting. The scratch project selects the CMake version in its
root `android/build.gradle` (a scratch-only `subprojects { ... }` block that sets
`android.externalNativeBuild.cmake.version = '3.31.6'` and a short `buildStagingDirectory` for
each library and the app). Keep that block when re-syncing the scratch copy.

## Smoke test checklist

1. Wrong password → "Invalid email or password".
2. Correct login → "My Day" dashboard.
3. Deliveries, Attendance and Schedule tabs load.
4. Force-stop and relaunch → still signed in.
5. Profile → Log Out → login screen; relaunch → still signed out.

## SDK 58 reference build (emulator APK, 2026-11-07)

Built once in the scratch copy `C:\b5\packages\mobile` (prebuild output, not tracked by git).

| Setting | Value |
|---|---|
| Expo / React Native | SDK 58 / 0.88 (`compileSdk` 37, `targetSdk` 36, `minSdk` 24, NDK 27.1.12297006, Gradle 9.4.1) |
| Windows | `LongPathsEnabled` = 1; CMake 3.31.6 / ninja 1.12.1 for every native module (see the path-limit section above) |
| Gradle | `assembleRelease --max-workers=1`, `org.gradle.jvmargs=-Xmx2048m`, `kotlin.compiler.execution.strategy=in-process`, no daemon, no parallel |
| ABI | `reactNativeArchitectures=x86_64` (emulator only) |
| Signing | the template's public debug keystore |
| API URL | `EXPO_PUBLIC_API_URL=http://10.0.2.2:3001/api/v1` (emulator-to-host alias; it does not exist on a phone) with `android:usesCleartextTraffic="true"` added to the scratch manifest |

Results:

- `BUILD SUCCESSFUL in 15m 16s` (565 tasks: 443 executed, 122 up-to-date, with a warm Gradle
  cache from earlier attempts). Six CMake builds ran for the one ABI: `react-native-worklets`,
  `react-native-reanimated`, `expo-modules-core`, `react-native-gesture-handler`,
  `react-native-screens` and the app's own codegen libraries.
- `app-release.apk`: 40,648,262 bytes (**38.8 MB**).
  - Native libraries: 25 files, **21.1 MB**, stored uncompressed (`expo.useLegacyPackaging=false`),
    all under `lib/x86_64/`. About 7.0 MB of that is compiled locally (the six CMake projects); the
    rest comes from prebuilt AARs (React Native 0.88 `libreactnative.so` 6.9 MB, Hermes, fbjni,
    Fresco, `libc++_shared.so`).
  - DEX 25.8 MB uncompressed (compressed inside the APK), JS bundle 4.0 MB, resources 4.7 MB.
- `aapt2 dump badging`: `package: name='com.constructos.app' versionCode='1' versionName='1.0.0'`,
  `minSdkVersion:'24'`, `targetSdkVersion:'36'`, `compileSdkVersion='37'`, `native-code: 'x86_64'`.
  `READ_EXTERNAL_STORAGE` appears only as `maxSdkVersion='32'` and is implied by
  `WRITE_EXTERNAL_STORAGE` (the source manifest removes the explicit declaration).
- `apksigner verify --print-certs`: `Verifies`, APK Signature Scheme v2, one signer,
  `CN=Android Debug, OU=Android, O=Unknown, L=Unknown, ST=Unknown, C=US`.
- 16 KB page size: `zipalign -c -P 16 -v 4` reports `Verification successful`, and every
  library's ELF `LOAD` segments are aligned to `0x4000` (checked with the NDK's `llvm-readelf`).
- Installed and smoke-tested on the Android 14 (API 34) and Android 16 (API 36) emulators. One
  intermittent native crash in Hermes was seen and is being investigated separately.

The scratch source predates mobile PRs #43, #45, #47, #51 and #55 (see "What the phone build
includes" below).

## Physical Android phone build plan (SDK 58)

Not run yet. This is the plan for one arm64 APK for the owner's test phones, side-loaded over USB.

### ABI choice: build `arm64-v8a` only

| | `arm64-v8a` only (recommended) | Universal (all 4 ABIs) |
|---|---|---|
| Runs on | 64-bit ARM phones: every phone that ships with Android 14 or 16 | Every phone and emulator, including 32-bit `armeabi-v7a` devices |
| Native libraries | One set of 25, about **21 MB** (estimated from the measured x86_64 set; the arm64 libraries are of similar size) | Four sets. **Estimate:** about 70 to 80 MB (two 64-bit sets of about 21 MB, two 32-bit sets that are usually somewhat smaller) |
| APK size | **About 39 MB** (estimate: the measured 38.8 MB with the ABI swapped; DEX, bundle and resources do not change) | **About 90 to 100 MB** (estimate). Native libraries are stored uncompressed, so they add almost their full size |
| Build time | **About 15 minutes** (estimate: same task count as the measured 15m 16s x86_64 build; the six CMake projects are compiled once, for arm64) | **Estimate: 35 to 60 minutes.** The six CMake projects are compiled four times (24 native builds), one after another with `--max-workers=1`. The prebuilt React Native and Hermes libraries are only copied, so they add size but little time |
| Memory risk | As measured (within a 2 GB Gradle heap) | Same peak, held about three times as long |

The React Native 0.88 prebuilts (`libreactnative.so`, Hermes, fbjni) cost no compile time for any
ABI choice. Only the six locally compiled CMake projects scale with the number of ABIs.

Before building, check the phone: `adb shell getprop ro.product.cpu.abilist` must list
`arm64-v8a`. If a test phone lists only `armeabi-v7a` (some low-end Android Go phones), build
`arm64-v8a,armeabi-v7a` instead, not all four. Emulators keep using the x86_64 build.

An EAS `preview` APK builds all four ABIs (cloud build, no local cost in time or memory). A
Play upload uses an AAB, and Play then serves each phone only its own ABI.

### What the phone build includes

Merged changes under `packages/mobile` since `ee0ea6a` (from `git log ee0ea6a..origin/main -- packages/mobile`):

| PR | Change | In the scratch source today? | Affects the Android APK? |
|---|---|---|---|
| #38 | Docs: R2 storage plan, Railway launch checklist, private tester network | n/a (docs) | No |
| #42 | Docs: SDK 58 local APK builds on Windows (path-length limit) | n/a (docs) | No |
| #43 | iOS: privacy manifest, config checks and EAS build procedure (`app.json` `ios.privacyManifests`) | No | No (iOS only) |
| #45 | Mobile: accessibility labels and keyboard-safe forms | No | **Yes** |
| #47 | Web: report notification action failures; mobile: keep the check-in field above the keyboard | No | **Yes** |
| #51 | Mobile: hide tabs a role cannot load; end the server session on logout after token expiry | No | **Yes** |
| #55 | iOS: readiness fixes and build milestones (`deliveries.tsx` camera handling, docs) | No | **Yes** (the camera-unavailable and "Open Settings" paths are shared code) |

All of these are JavaScript or `app.json` changes. `package.json` dependencies in `main` and in
the scratch copy are identical (checked on 2026-11-07), so the sync below needs no `npm install`
and no new `expo prebuild`. If a later sync changes dependencies or the `android` / `plugins`
part of `app.json`, stop: the native project has to be regenerated first.

### Steps

Paths: `<main>` is a clean checkout of `main`; the scratch project is `C:\b5\packages\mobile`.
Hold the shared heavy-job lock for step 5, and close emulators and Metro first.

1. **Sync `packages/mobile` from `main` into the scratch copy**, keeping its `android/` folder
   (the generated project with the scratch CMake hook) and its `node_modules`:

   ```powershell
   robocopy "<main>\packages\mobile" "C:\b5\packages\mobile" /E /XD android node_modules docs .expo /NFL /NDL
   ```

   Use `/E`, never `/MIR` (that would delete `android/`). Afterwards, confirm the root
   `android/build.gradle` still has the scratch `subprojects { ... }` CMake block, and that
   `package.json` dependencies still match the previous copy.
2. **Select the ABI.** In `C:\b5\packages\mobile\android\gradle.properties` set
   `reactNativeArchitectures=arm64-v8a` (it is `x86_64` for the emulator build). Passing
   `-PreactNativeArchitectures=arm64-v8a` to Gradle does the same without editing the file.
3. **Set the API URL to the tailnet HTTPS address:**
   `EXPO_PUBLIC_API_URL=https://<machine>.<tailnet>.ts.net/api/v1`, from
   [TESTER-NETWORK-TAILSCALE.md](TESTER-NETWORK-TAILSCALE.md), and only after its section 6
   checks pass.
   - Never `http://10.0.2.2:3001/api/v1`: that address exists only inside the emulator.
   - Never a public URL (no Funnel, no public tunnel, never the production host).
   - The value is compiled into the bundle. Check that the build runner passes this value: the
     runner used for the emulator build sets `10.0.2.2` itself and overrides the shell
     environment, so it must not be reused unchanged.
4. **Remove the cleartext exception.** The scratch manifest
   `C:\b5\packages\mobile\android\app\src\main\AndroidManifest.xml` currently has
   `android:usesCleartextTraffic="true"` on `<application>`, added for the emulator's HTTP API.
   Delete that attribute for the phone build. With `targetSdk` 36 cleartext is off by default,
   and an HTTPS API with a publicly trusted `*.ts.net` certificate needs no cleartext setting
   and no network security config.
5. **Run one bounded build** (single attempt, stop after 60 minutes, do not retry in a loop):

   ```powershell
   cd C:\b5\packages\mobile\android
   $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
   $env:NODE_ENV = "production"
   $env:EXPO_PUBLIC_API_URL = "https://<machine>.<tailnet>.ts.net/api/v1"
   .\gradlew.bat assembleRelease --max-workers=1 --console=plain
   ```

   Keep the measured settings in `gradle.properties` (2 GB heap, in-process Kotlin, no daemon).
   If it fails, record the first error and stop.
6. **Verify the APK** (`build-tools\37.0.0`; `apksigner` needs `JAVA_HOME`):

   ```powershell
   $bt  = "$env:LOCALAPPDATA\Android\Sdk\build-tools\37.0.0"
   $apk = "app\build\outputs\apk\release\app-release.apk"
   & "$bt\aapt2.exe" dump badging $apk | Select-String "package:|SdkVersion|native-code"
   & "$bt\aapt2.exe" dump xmltree --file AndroidManifest.xml $apk | Select-String -SimpleMatch "usesCleartextTraffic"
   & "$bt\apksigner.bat" verify --print-certs $apk
   & "$bt\zipalign.exe" -c -P 16 4 $apk
   ```

   Pass only if all of these hold:
   - `package: name='com.constructos.app'`, `minSdkVersion:'24'`, `targetSdkVersion:'36'`;
   - `native-code: 'arm64-v8a'` and no other ABI;
   - the `xmltree` search prints nothing (no cleartext attribute);
   - `apksigner` prints `Verifies` and the signer is the expected key (the debug key for internal
     testing);
   - `zipalign` reports `Verification successful` (16 KB alignment);
   - the bundle contains the tailnet URL: unzip `assets/index.android.bundle` from the APK and
     search it for `ts.net/api/v1`.
7. **Install over USB.** On the phone, turn on Developer options → USB debugging, connect it and
   accept the computer's RSA key prompt. Then:

   ```powershell
   adb devices                       # the phone is listed as "device", not "unauthorized"
   adb -s <serial> install -r app\build\outputs\apk\release\app-release.apk
   ```

   If an earlier build signed with a different key is installed, `adb install` fails with
   `INSTALL_FAILED_UPDATE_INCOMPATIBLE`; uninstall it first (`adb uninstall com.constructos.app`),
   which also clears its local data. Turn on the Tailscale VPN on the phone, then run the smoke
   test checklist above, plus the camera prompt on a delivery photo.

### Android 14 and Android 16 compatibility

- `minSdk` 24 (Android 7.0) and `targetSdk` 36 (Android 16), read from the built APK. Android 14
  (API 34) and Android 16 (API 36) are both in range, and the x86_64 build passed the smoke test on
  emulators of both versions. The arm64 build uses the same code and settings, so the open
  risk on phones is device-specific behaviour, not the API level.
- With `targetSdk` 36, Android 16 enforces edge-to-edge drawing. The app already pads its app bars
  and tab bar by the safe-area insets (`IOS-READINESS.md`, section 2, item 24).
- `POST_NOTIFICATIONS` (Android 13+) is declared by `expo-notifications`, so the phone asks for
  notification permission at first sign-in.
- `WRITE_EXTERNAL_STORAGE` is limited to `maxSdkVersion` 32, so Android 14 and 16 never see it.
- 16 KB memory pages (offered on some Android 15+ devices): the native libraries are 16 KB aligned
  (see the reference build), so the app loads on such devices.

## Release signing (Play upload)

- **Internal side-loaded testing:** the template's debug keystore is acceptable. Its key is
  public, so anyone could sign an "update" with it. Hand debug-signed APKs only to the test group.
- **Google Play:** an upload needs an **upload keystore** that the owner creates and keeps.
  Play App Signing then holds the key that signs what users install. Never commit the keystore
  or its passwords (`*.jks` and `*.keystore` are git-ignored), never put them in `app.json`,
  `eas.json` or a committed `gradle.properties`, and keep a backup outside the repository.
  Losing the upload key means asking Google for an upload-key reset.
- **Preferred route: EAS-managed credentials.** The `production` profile builds an AAB on EAS, and
  EAS can generate and store the upload keystore remotely (`credentialsSource` is `remote` by
  default). Creating one is an owner step.
- **Local route (only if a local release build must be uploaded).** Nothing below has been
  created. The owner generates the keystore with `keytool`, outside the repository. The build
  reads its location and passwords from properties kept outside the repository, either in the
  user-level `%USERPROFILE%\.gradle\gradle.properties` or in environment variables:

  ```properties
  # %USERPROFILE%\.gradle\gradle.properties (never the project's android/gradle.properties)
  CONSTRUCTOS_UPLOAD_STORE_FILE=C:\\keys\\constructos-upload.jks
  CONSTRUCTOS_UPLOAD_KEY_ALIAS=constructos-upload
  CONSTRUCTOS_UPLOAD_STORE_PASSWORD=...
  CONSTRUCTOS_UPLOAD_KEY_PASSWORD=...
  ```

  Gradle also reads `ORG_GRADLE_PROJECT_<NAME>` environment variables as the same properties
  (for example `ORG_GRADLE_PROJECT_CONSTRUCTOS_UPLOAD_STORE_PASSWORD`), which suits CI secrets.
  In the generated `android/app/build.gradle` (scratch copy only, because `android/` is not
  committed), add a `release` signing config that uses them, and point `buildTypes.release` at
  it instead of `signingConfigs.debug`:

  ```groovy
  signingConfigs {
      release {
          if (project.hasProperty('CONSTRUCTOS_UPLOAD_STORE_FILE')) {
              storeFile file(CONSTRUCTOS_UPLOAD_STORE_FILE)
              storePassword CONSTRUCTOS_UPLOAD_STORE_PASSWORD
              keyAlias CONSTRUCTOS_UPLOAD_KEY_ALIAS
              keyPassword CONSTRUCTOS_UPLOAD_KEY_PASSWORD
          }
      }
  }
  ```

  Build an AAB for Play (`bundleRelease`), not an APK. A phone that has a debug-signed build
  installed must uninstall it before it can install a build signed with the upload key.
