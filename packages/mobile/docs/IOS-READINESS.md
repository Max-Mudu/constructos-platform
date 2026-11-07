# ConstructOS mobile: iOS readiness and build configuration

Last reviewed: 2026-11-07, on branch `feat/ios-eas-build` (Expo SDK 58; base `main` @ `ee0ea6a`): privacy manifest,
EAS simulator procedure and smoke test (sections 8 and 9). Before that: `feat/ios-sdk-upgrade` (SDK 51 → 58; base `9e03d0f`).
First written on `feat/ios-readiness` (#5, base `149b484`); sections 1 and 5 keep that history.

## Read this first: what has and has not been verified

This review ran on Windows 11. There was no Mac, no Xcode, no iOS Simulator and no
iPhone. **Nothing in this document has been run on iOS.** Chrome's iPhone emulation
was not used and would not count as iOS testing.

Every item below has one of three statuses:

| Status | Meaning |
|---|---|
| **VERIFIED-STATIC** | Checked by reading the code or config, or by running the Expo config resolver (`expo config --type introspect`). That resolver prints the Info.plist, entitlements and AndroidManifest that prebuild would generate, without building anything. |
| **UNVERIFIED-RUNTIME** | Can only be confirmed by an EAS build plus an install on a simulator or device. Nobody has done this yet. |
| **BLOCKED-OWNER** | Needs an account, a purchase, a credential or a decision that only the owner can provide. |

Stack: Expo SDK 58 (`expo ~58.0.23`), React Native 0.88.1, React 19.3.0, expo-router 58.0.30,
iOS deployment target **16.4** (from `expo/Expo.podspec`), Android `targetSdk` 36 / `compileSdk` 37 /
`minSdk` 24 (from `react-native/gradle/libs.versions.toml`). EAS CLI 18.7.0 is installed locally;
the current release is 27.5.0 (`npm view eas-cli version`, 2026-11-07).

---

## 0. Expo SDK 58 upgrade: what it changes for iOS

| Topic | Before (SDK 51) | Now (SDK 58) | Status |
|---|---|---|---|
| App Store Connect upload rule: "built with Xcode 26 or later using an SDK for iOS 26" (Apple, in force since 2026-04-28) | EAS image `sdk-51` = macOS Sonoma 14.5 + **Xcode 15.4**. Uploads would be rejected. | EAS image `sdk-58` / `latest` = `macos-tahoe-26.6-xcode-27.1`. Meets the rule. | VERIFIED-STATIC (EAS image table and Apple's upcoming-requirements page, read 2026-11-07). The upload itself is UNVERIFIED-RUNTIME. |
| Minimum iOS version for users | 13.4 | **16.4** | VERIFIED-STATIC (`Expo.podspec`). **Owner:** iPhones that cannot run iOS 16.4 (iPhone 7 and older) can no longer install the app. Apple's own floor (target iOS 13+, from 2026-09-09) is met. |
| iOS 27 scene life cycle | Not applicable | `expo prebuild` generates `SceneDelegate.swift` and `UIApplicationSceneManifest`. This app uses Continuous Native Generation (no committed `ios/` folder) and has no custom AppDelegate code, so nothing needs migrating. | VERIFIED-STATIC (no `ios/` folder, no config plugin touching the AppDelegate). UNVERIFIED-RUNTIME on iOS 27. |
| Liquid Glass stack headers (iOS 26+) | — | Every navigator here sets `headerShown: false` and draws its own app bar, so the transparent header default does not apply. | VERIFIED-STATIC |
| Foreground notifications | `shouldShowAlert` | `shouldShowBanner` + `shouldShowList` (same behaviour: banner and Notification Centre). | VERIFIED-STATIC (`app/_layout.tsx`) |
| Remote push in **Expo Go** | Worked on Android and iOS | Expo Go on **Android** has no remote push since SDK 53, so `src/utils/push.ts` skips token registration there. Development, preview and store builds, and Expo Go on iOS, still register. | VERIFIED-STATIC |
| File access | `expo-file-system` | The classic API moved to `expo-file-system/legacy` (the documented import path). Same functions and paths. | VERIFIED-STATIC. On Android the app start, which reads and writes the first-launch marker through it, ran without errors (section 7) |
| Camera capture | `MediaTypeOptions.Images` | `mediaTypes: ['images']` | VERIFIED-STATIC / UNVERIFIED-RUNTIME on iOS |
| Splash screen | top-level `splash` | `expo-splash-screen` plugin (same image and background; the image is drawn 200 pt wide instead of full screen, which is how SDK 52+ splash screens work) | VERIFIED-STATIC |

What was **not** changed: bundle id, purpose strings, entitlements, encryption flag, EAS
profiles, and the submit placeholders. The resolved Info.plist and entitlements are the same as
before the upgrade (section 7).

---

## 1. Configuration changes made in the iOS-readiness branch (#5)

### `app.json` (iOS)

| Change | Why |
|---|---|
| Removed `NSLocationWhenInUseUsageDescription` | The app never uses location. `expo-location` is not a dependency, no code reads coordinates, and the only "Location Services" item is a Profile toggle that does nothing (see finding B7). A purpose string for a feature that does not exist is misleading in App Review and in the App Privacy questionnaire. |
| Removed the generic `NSMicrophoneUsageDescription` (`expo-image-picker` → `microphonePermission: false`) | The `expo-image-picker` config plugin is applied automatically and adds "Allow $(PRODUCT_NAME) to access your microphone" by default. The app only captures still images (`MediaTypeOptions.Images`), and the iOS sources of `expo-image-picker` 15.1 do not reference any audio-capture API, so removing the string should not trigger Apple's ITMS-90683 "missing purpose string" upload check. |
| Rewrote the camera string, set through the plugin `cameraPermission` | The new text describes the real trigger: adding a photo to a delivery record. |
| Rewrote the photo-library string, set through the plugin `photosPermission` | The old text said the app "saves delivery photos and downloaded reports to your photo library". It does neither. The key is **kept, not removed**, because `expo-image-picker` links `PHPhotoLibrary`, and dropping the key risks ITMS-90683 when the build is uploaded. The app never asks for photo-library permission today. |
| Rewrote `NSPhotoLibraryAddUsageDescription` | Kept, because the iOS share sheet that `expo-sharing` opens can offer "Save Image", and that action crashes if this key is missing. The new text describes exactly that. |
| Replaced the generic `NSFaceIDUsageDescription` (`expo-secure-store` → `faceIDPermission`) | The secure-store plugin adds a generic Face ID string. The app never sets `requireAuthentication`, but the native `get()` also searches for auth-protected Keychain items, so the key is kept to avoid any chance of a missing-string crash. The text is now accurate. |
| Added `ios.config.usesNonExemptEncryption: false` (sets `ITSAppUsesNonExemptEncryption = false`) | The only encryption the app uses is HTTPS through the OS networking stack and the iOS Keychain through `expo-secure-store`. That is the standard exemption for encryption provided by the operating system, so no export-compliance documents are needed. Setting the key also stops App Store Connect and TestFlight from asking the export-compliance question on every build. **Owner: confirm this is still true if you add custom cryptography (for example a bundled crypto library or end-to-end encryption).** |

The resolved Info.plist now contains exactly these purpose strings: Camera,
PhotoLibrary, PhotoLibraryAdd and FaceID. None of them uses a generic default.

### `eas.json`

| Change | Why |
|---|---|
| `development` and `preview` no longer hard-code `EXPO_PUBLIC_API_URL`. They now set `"environment": "development"` and `"environment": "preview"`. | The hard-coded value was the Railway production URL, which is offline. EAS CLI gives an `env` value in `eas.json` priority over an EAS environment variable (checked in `eas-cli/build/build/evaluateConfigWithEnvVarsAsync.js`: `{ ...serverEnvVars, ...buildProfile.env }`), so the URL had to be removed before the owner could supply one through EAS. See section 4. |
| Added a `preview-simulator` profile (`extends: preview`, `ios.simulator: true`) | Produces an iOS Simulator `.app`. It needs no Apple Developer membership, no signing and no device registration. It is useful to anyone with a Mac. |
| `cli.version` raised from `>= 7.0.0` to `>= 16.0.0` | Build-profile `environment` is a recent EAS CLI feature. 16.0.0 is a conservative floor; the config was validated with EAS CLI 18.7.0 (`@expo/eas-json` 18.6.0). |
| `production` left unchanged | It still points at `https://mellow-acceptance-production-3902.up.railway.app/api/v1`, which is offline. Changing the production URL is the owner's call (section 4). |
| `submit.production.ios` placeholders left as they were | `appleId`, `ascAppId` and `appleTeamId` are still placeholders. **They fail EAS validation.** `@expo/eas-json` rejects them: "Invalid Apple App Store Connect App ID ... should consist only of digits" and "Invalid Apple Team ID ... 10 uppercase letters or digits". So `eas submit -p ios` and `eas build --auto-submit` will fail until the owner replaces them (section 3, step 9). Build profiles are not affected. |

### Docs updated to match the config

- `docs/store/PERMISSIONS.md`: now lists the real permission set and the reason for each.
- `docs/store/APP_STORE.md`, `PLAY_STORE.md`, `PRIVACY_POLICY.md`: removed the "GPS-verified check-ins" and location-collection claims. The app has no location feature, and claiming one is an App Review accuracy risk (Guideline 2.3.1) and would make the privacy answers wrong.
- `docs/DEPLOYMENT.md`: corrected the API-URL table and the claim that `google-service-account.json` is git-ignored.

---

## 2. iOS readiness checklist

### Project and build configuration

| # | Item | Status | Notes |
|---|---|---|---|
| 1 | Bundle ID `com.constructos.app` is set, and Android `package` matches | VERIFIED-STATIC | |
| 1a | Bundle ID is registered and available under the owner's Apple team | BLOCKED-OWNER | Bundle IDs are unique across all of Apple. If someone else already holds this one, change `ios.bundleIdentifier` before the first build. |
| 2 | `buildNumber` / `version` handling | VERIFIED-STATIC | `appVersionSource: remote` means EAS stores the build number. The `buildNumber: "1"` in `app.json` is ignored for EAS builds. `production.autoIncrement` bumps it. |
| 3 | iPhone-only (`supportsTablet: false`), portrait | VERIFIED-STATIC | On iPad the app runs in iPhone compatibility mode, and App Review still tests on iPad that way. The resolved plist also allows `PortraitUpsideDown` on iPhone (Expo default). |
| 4 | URL scheme `constructos` (also `com.constructos.app`) in `CFBundleURLTypes` | VERIFIED-STATIC | There are no universal links (no `associatedDomains`). Deep links are handled only through expo-router file routes and the notification-tap handler. |
| 5 | Purpose strings match what the app actually does | VERIFIED-STATIC | Section 1. |
| 6 | Encryption export compliance (`ITSAppUsesNonExemptEncryption=false`) | VERIFIED-STATIC | The reasoning is in section 1. The owner keeps the legal responsibility for the answer. |
| 7 | Push entitlement `aps-environment` | VERIFIED-STATIC | Added by the `expo-notifications` plugin as `development`. For ad hoc and App Store exports Xcode normally re-signs it as `production`. That has not been verified (UNVERIFIED-RUNTIME). |
| 8 | App Transport Security | VERIFIED-STATIC (not changed) | The resolved plist has the Expo template default `NSAllowsArbitraryLoads: true` plus a `localhost` exception. Every EAS profile is meant to use HTTPS. Recommendation for a later change: tighten ATS for production once the development workflow is settled. App Review can ask why arbitrary loads are allowed. |
| 9 | `expo-doctor` | VERIFIED-STATIC, one expected finding | `npx expo-doctor@latest` (1.21.6) on SDK 58: 19/20 checks pass. The remaining finding is "duplicate react": `react@19.3.0` in `packages/mobile/node_modules` (this app) and `react@18.2.0` at the repository root (it belongs to `packages/web`, which must stay on React 18). React has no native code, and Expo's monorepo module resolution (`experiments.autolinkingModuleResolution`, on by default in a workspace and set explicitly in `app.json`) resolves `react`, `react-dom` and `react-native` from this app for every import in the bundle. Section 7 shows the exported bundles contain only React 19.3.0. |
| 10 | `development` profile is actually buildable | **BLOCKED (dependency)** | It sets `developmentClient: true`, but `expo-dev-client` is not in `package.json`. EAS will refuse or prompt to install it. Adding the dependency is a lead decision. Use `preview` or `preview-simulator` until then. |
| 11 | `channel` on profiles | VERIFIED-STATIC | Channels only matter with `expo-updates`, which is not installed. They are harmless. OTA updates are not available. |
| 12 | Apple's minimum Xcode/iOS SDK for App Store Connect uploads | VERIFIED-STATIC (config) / UNVERIFIED-RUNTIME (upload) | Apple: "Apps uploaded to App Store Connect must be built with Xcode 26 or later using an SDK for iOS 26" from 2026-04-28. SDK 58 builds on the EAS image `macos-tahoe-26.6-xcode-27.1` (aliases `sdk-58`, `latest`). `eas.json` pins no image, so EAS picks the SDK 58 default. SDK 51 would have built with Xcode 15.4 and been rejected. Re-check Apple's page before each release season; Apple raises the floor every spring. |
| 13 | iOS 16.4+ deployment target | VERIFIED-STATIC | From `expo/Expo.podspec` (SDK 58). Was 13.4 on SDK 51. |
| 13a | App privacy manifest (`PrivacyInfo.xcprivacy`) declares the required-reason APIs | VERIFIED-STATIC (config) / UNVERIFIED-RUNTIME (upload) | Added `ios.privacyManifests` in `app.json` (section 8.1). The SDK 58 prebuild template has no app-level manifest, so without this key the app relies only on the per-pod resource bundles, and `expo-sharing` (uses `UserDefaults`) ships none. Only an App Store Connect upload proves Apple accepts it (no ITMS-91053 e-mail). |

### Runtime behaviour (code re-read on SDK 58 at `main` @ `9e03d0f`; nothing was run on iOS)

| # | Item | Status | Notes |
|---|---|---|---|
| 14 | Camera capture for delivery photos | VERIFIED-STATIC / UNVERIFIED-RUNTIME | `deliveries.tsx` `pickPhoto()` asks for camera permission, then calls `launchCameraAsync({ mediaTypes: ['images'] })` (SDK 58 form). The upload uses the asset's `mimeType`, falling back to `image/jpeg`. Photo-library permission is never requested. |
| 15 | Push permission + registration | VERIFIED-STATIC / UNVERIFIED-RUNTIME | `src/utils/push.ts`: skips simulators (`Device.isDevice`) and Expo Go on Android, asks for permission only when undecided, passes `projectId` from `extra.eas.projectId`. Called after sign-in (`login.tsx`) and after a restored session (`app/_layout.tsx`). The `aps-environment` entitlement is present in the resolved config (section 7). Delivery needs an APNs key in EAS (BLOCKED-OWNER, section 3 step 6). |
| 16 | Notification tap routing | VERIFIED-STATIC / UNVERIFIED-RUNTIME | `useLastNotificationResponse()` in `app/_layout.tsx` also covers the tap that cold-starts the app (B2 fixed). |
| 17 | Session storage and refresh | VERIFIED-STATIC | Tokens are in the Keychain (`expo-secure-store`). A first-launch marker clears Keychain tokens left over from a previous install (B9 fixed in #12). |
| 18 | Offline queue | VERIFIED-STATIC | JSON file in `documentDirectory`, flushed when the app returns to the foreground. `documentDirectory` is still included in iCloud backups (B13, open, low). |
| 19 | Live updates (SSE) | VERIFIED-STATIC / UNVERIFIED-RUNTIME | The provider restarts when the signed-in user changes (B8 addressed). iOS suspends the socket in the background; behaviour after resume is not verified on iOS. |
| 20 | Report PDF/CSV download (Reports tab) | VERIFIED-STATIC / UNVERIFIED-RUNTIME | `src/utils/openFile.ts`: on iOS it opens the share sheet with `UTI` `com.adobe.pdf` or `public.comma-separated-values-text`; the Android-only content-URI path is behind `Platform.OS === 'android'` (B1 fixed). |
| 21 | Drawing PDF (Projects tab) | VERIFIED-STATIC / UNVERIFIED-RUNTIME | `Sharing.shareAsync` passes `UTI: 'com.adobe.pdf'` (B12 fixed). |
| 22 | Android-only APIs called without a platform check | VERIFIED-STATIC | None found. `getContentUriAsync` and `expo-intent-launcher` are used only on Android. |
| 23 | Keyboard handling | VERIFIED-STATIC (partly) / UNVERIFIED-RUNTIME | `KeyboardAvoidingView` is now used in attendance, deliveries, inventory, invoices, labour, schedule and login. The text inputs in `projects.tsx` and `reports.tsx` still have none (B5, open). |
| 24 | Safe areas | VERIFIED-STATIC / UNVERIFIED-RUNTIME | App bars use `useAppBarInset()` (max of 56 pt and the top inset + 12), and the tab bar adds `insets.bottom` (B3 inset part and B4 fixed). Android is now always edge-to-edge (SDK 54+), which the same insets cover. |
| 25 | iPhone layout | **Open** | Still 7 to 9 bottom tabs for supervisor, PM, admin and finance roles (B3, tab count). |
| 26 | Accessibility (VoiceOver) | **Open (partly addressed)** | Labels/roles exist only in `login.tsx` and `Button.tsx` (B14). |
| 27 | App Review: placeholder UI | VERIFIED-STATIC | The placeholder toggles and "coming soon" links were removed from Profile (B7). Privacy Policy and Terms links are still needed for review (owner content). |
| 28 | Account deletion requirement (Guideline 5.1.1(v)) | VERIFIED-STATIC (not applicable today) | Accounts are created by the company admin, not in the app. Revisit if self-signup is added. |
| 29 | API URL in iOS builds | **BLOCKED-OWNER** | Section 4. A release build without `EXPO_PUBLIC_API_URL` now shows a configuration error instead of calling a developer address (`src/constants/resolveApiUrl.ts`, B10 addressed). |

---

## 3. Minimum owner steps for an internal iOS build

These are the steps for an ad hoc build (`preview`) and for internal TestFlight
(`production`). Nobody has run any of the EAS commands below in this review. Each one
signs in to Apple, creates credentials or uses EAS build minutes, so the owner runs them.

**What the owner needs before the first iOS build**

| Prerequisite | Who | Where it is used |
|---|---|---|
| Apple Developer Program membership (US$99/year, purchase decision) | Owner | Everything except `preview-simulator` |
| Apple Team ID (10 characters) | Owner | `eas.json > submit.production.ios.appleTeamId`; EAS asks for the team on first build |
| Bundle ID `com.constructos.app` registered under that team, with Push Notifications | Owner (EAS can register it) | `app.json > ios.bundleIdentifier` |
| UDIDs of the test iPhones (ad hoc only) | Owner / testers, via `eas device:create` | Embedded in the ad hoc provisioning profile |
| APNs key (.p8) | Owner, via `eas credentials -p ios` | Expo push service → iOS devices |
| Distribution certificate + provisioning profile | Generated by EAS on the first `eas build -p ios` (or `eas credentials -p ios`), after Apple sign-in | Code signing |
| App Store Connect app record (`ascAppId`) and Apple ID e-mail | Owner (TestFlight only) | `eas.json > submit.production.ios` |
| Current EAS CLI | Owner: `npm install -g eas-cli@latest` (27.5.0 on 2026-11-07; 18.7.0 is installed here) | All `eas` commands |

0. **Update the EAS CLI and confirm the account** (read-only):
   ```bash
   npm install -g eas-cli@latest
   cd packages/mobile
   eas whoami                 # expect: dalmarmudu (matches app.json > owner)
   eas build:configure --help # read-only; the project is already configured
   ```
1. **Apple Developer Program membership** (BLOCKED-OWNER). It costs US$99 per year and is the owner's purchase decision; nothing has been bought. You enroll at <https://developer.apple.com/programs/enroll/>. Organization enrollment needs a D-U-N-S number and decides the seller name shown on the App Store. Without membership you can only build `preview-simulator`.
2. **Apple Team ID** (BLOCKED-OWNER). Find it at developer.apple.com → Account → Membership details. It is 10 uppercase letters or digits, and it goes into `eas.json > submit.production.ios.appleTeamId`.
3. **Register the bundle ID `com.constructos.app`** (BLOCKED-OWNER). Either let EAS do it during the first `eas build -p ios` (sign in with the Apple ID when asked), or create it under Certificates, IDs & Profiles → Identifiers. The App ID needs the **Push Notifications** capability. EAS syncs capabilities from the entitlements automatically, so check that it is enabled after the first build.
4. **Register test iPhones (ad hoc only)** (BLOCKED-OWNER). Run:
   ```bash
   cd packages/mobile
   eas device:create          # prints a URL/QR; open it on each iPhone to install the registration profile
   eas device:list            # confirm each UDID is registered
   ```
   Only registered devices can install an ad hoc build. Register them before building: a device added later needs a new build or a re-sign (`eas build:resign`). On iOS 16 and later, the tester must also turn on **Settings → Privacy & Security → Developer Mode** to open ad hoc builds.
5. **Choose the API URL** (BLOCKED-OWNER). See section 4. Do this before step 7.
6. **APNs key for push notifications** (BLOCKED-OWNER). Run:
   ```bash
   eas credentials -p ios
   # → choose the build profile → "Push Notifications: Manage your Apple Push Notifications Key"
   # → let EAS generate a key, or upload an existing .p8 from developer.apple.com → Keys
   ```
   EAS also offers to set this up during the first `eas build -p ios`. Expo's push service needs this key to deliver to iOS. Without it, `getExpoPushTokenAsync` may still return a token, but notifications will not arrive.
7. **Ad hoc build for registered devices:**
   ```bash
   eas build -p ios --profile preview
   ```
   EAS asks to sign in to Apple and generates the distribution certificate and an ad hoc provisioning profile that includes the registered UDIDs. Install from the build page link or QR code on a registered iPhone.
8. **Optional simulator build (needs a Mac to run):**
   ```bash
   eas build -p ios --profile preview-simulator
   ```
   No Apple account or credentials are needed. The exact procedure, including how to install the `.tar.gz` in Xcode Simulator, is in section 8.2.
9. **Internal TestFlight (instead of, or after, ad hoc):**
   1. Create the app record in App Store Connect (My Apps → + → New App) with the bundle ID from step 3. Its numeric **Apple ID** is the `ascAppId`.
   2. Replace the three placeholders in `eas.json > submit.production.ios` (`appleId`, `ascAppId`, `appleTeamId`). Until then `eas submit` fails validation (section 1).
   3. Fix the production API URL. The `production` profile still points at the offline Railway host (section 4).
   4. Run `eas build -p ios --profile production`, then `eas submit -p ios --profile production --latest`.
   5. In App Store Connect → TestFlight, add internal testers. They must be App Store Connect users on the team. Internal testing does not need Beta App Review.
   6. Checklist item 12: on SDK 58 the build uses Xcode 27.1, which meets Apple's Xcode 26 upload rule. Do not pin an older `ios.image` in `eas.json`.
10. **Expo account.** `eas whoami` shows the CLI is signed in as `dalmarmudu`, which matches `app.json > owner`. The EAS `projectId` is already set.

---

## 4. API URL decision (BLOCKED-OWNER)

- The Railway production URL that was hard-coded in every profile is offline. This branch does **not** invent a replacement.
- `development` and `preview` (and therefore `preview-simulator`) now read `EXPO_PUBLIC_API_URL` from the matching **EAS environment**. Before building, the owner sets it:
  ```bash
  cd packages/mobile
  eas env:create --environment preview     --name EXPO_PUBLIC_API_URL --value "https://<your-api-host>/api/v1" --visibility plaintext
  eas env:create --environment development --name EXPO_PUBLIC_API_URL --value "https://<your-api-host>/api/v1" --visibility plaintext
  eas env:list --environment preview
  ```
  The value is a placeholder. Use the real host.
- Rules for the value:
  - It **must end in `/api/v1`**. `src/constants/api.ts` uses it as the axios base URL, and other files strip `/api/v1` to build file URLs.
  - It must be **HTTPS** with a publicly trusted certificate.
  - It is compiled into the JavaScript bundle and is readable by anyone who has the app. That is why the visibility is `plaintext`, not `secret`. Never put credentials in an `EXPO_PUBLIC_*` variable.
- Optional: set `EXPO_PUBLIC_WEB_URL` (no trailing slash) the same way. The login screen's "Forgot password" link opens `${EXPO_PUBLIC_WEB_URL}/forgot-password`, and without it shows a "contact your administrator" alert.
- **Check the build log.** EAS prints `Environment variables ... loaded from the "preview" environment on EAS: EXPO_PUBLIC_API_URL`. If it says none were found, cancel the build: the app would fall back to the Android-emulator-only `http://10.0.2.2:3001/api/v1` (finding B10).
- **Production:** still hard-coded to the offline Railway URL, so a production or TestFlight build today ships an app that cannot reach its API. The owner should either update `build.production.env.EXPO_PUBLIC_API_URL` in `eas.json` once the production API exists, or remove that `env` entry and use `eas env:create --environment production ...` in the same way.

---

## 5. iOS code findings for workstream B (runtime code; not changed here)

Line numbers refer to `main` @ `149b484`, where these were found.

**Status re-checked on `main` @ `9e03d0f` (2026-11-07, static only):** addressed: B1, B2, B4, B6 (all 7 page-sheet modals have `onRequestClose`), B7, B8 (restarts on user change), B9, B10, B11 (`expo-intent-launcher` is now used by `src/utils/openFile.ts`), B12, B15, and the safe-area part of B3. Still open: B3 (7 to 9 tabs for some roles), B5 (`projects.tsx`, `reports.tsx` inputs), B13, B14 (labels only in `login.tsx` and `Button.tsx`).

| ID | Severity | File:line | Issue | Suggested fix |
|---|---|---|---|---|
| B1 | **High (iOS broken)** | `app/(tabs)/reports.tsx:804-807` | `FileSystem.getContentUriAsync` is Android-only, so it throws on iOS. The fallback `Linking.openURL(file://<cache>)` cannot open an app-sandbox file on iOS, so every PDF/CSV report download on iOS ends in "Download Failed". | On iOS use `Sharing.shareAsync(localUri, { UTI: 'com.adobe.pdf' })` (or `'public.comma-separated-values-text'` for CSV). Keep the content-URI path behind `Platform.OS === 'android'`. |
| B2 | Medium | `app/_layout.tsx:81-120` | The notification-tap listener returns early when `!user`. On a cold start, auth is not restored yet, so the tap is dropped. The initial response is also never read. | Use `Notifications.useLastNotificationResponse()` (or `getLastNotificationResponseAsync`), and handle it once `isLoading` is false and the user is set. |
| B3 | Medium | `app/(tabs)/_layout.tsx:8-13` (style), `:57-102` (tab lists) | `tabBarStyle.height: 60` / `paddingBottom: 8` replaces React Navigation's safe-area bottom padding, so on Face ID iPhones the tab bar sits on the home indicator. Supervisor, PM, admin and finance roles have 7 to 9 tabs, which gives touch targets under 44 pt on 375 pt wide iPhones. | Drop the fixed height or add `useSafeAreaInsets().bottom`. Keep at most 5 tabs and move the rest to a "More" screen. |
| B4 | Medium | `app/(tabs)/attendance.tsx:810`, `:919`; `app/(tabs)/index.tsx:308`; `app/(tabs)/profile.tsx:527`; `app/(tabs)/schedule.tsx:1075` | The app-bar `paddingTop: 56` is hard-coded. The Dynamic Island inset is 59 pt or more, so the header runs under the status bar, while SE-size phones get extra space. These screens do not use the `Screen`/`SafeAreaView` wrapper. | Use `useSafeAreaInsets().top` (plus a design offset), or wrap the screens in `SafeAreaView` with `edges={['top']}`. |
| B5 | Medium | Modals: `attendance.tsx:341`, `deliveries.tsx:378`, `labour.tsx:208`, `schedule.tsx:246`, `schedule.tsx:507`. Forms: `projects.tsx:188-206`, `:396`, `:663`; `reports.tsx:742`; `deliveries.tsx:249-273` | Text inputs sit with no `KeyboardAvoidingView` or keyboard-aware scroll view, so on iOS the keyboard covers the lower fields. `inventory.tsx` and `invoices.tsx` already do this correctly. | Wrap the content in `KeyboardAvoidingView behavior="padding"` on iOS, as `inventory.tsx:211` does, and set `keyboardShouldPersistTaps="handled"` on the scroll views. |
| B6 | Low-Medium (verify on device) | The same five `presentationStyle="pageSheet"` modals as B5 | They have no `onRequestClose`. On iOS a page sheet can be swiped down; without the callback, the screen's `visible` state is not reset when that happens. | Add `onRequestClose={onClose}` to each one, as `inventory.tsx:210` does. |
| B7 | Medium (App Review) | `app/(tabs)/profile.tsx:33-35`, `:337-359`, `:250`, `:362-365` | The "Notifications", "Dark Mode" and "Location Services" toggles are UI-only and change nothing. "Location Services" suggests the app uses location, which it does not. Edit Profile, Help Center, Terms, Privacy Policy and Report a Bug only show "coming soon". | Remove the Location toggle. Wire up or remove the other toggles. Link Privacy Policy and Terms to real URLs before review (Guideline 2.1 completeness, 5.1.1 privacy policy access). |
| B8 | Medium (both platforms) | `src/providers/SSEProvider.tsx:39-46`, `:82-88` | `connect()` runs only on mount. If there was no token then (a fresh sign-in), live updates never start. Reconnects reuse a possibly expired access token, with no refresh. iOS suspends the socket in the background. | Reconnect when the auth user changes and on `AppState` returning to `active`. Refresh the token before reconnecting after a 401. |
| B9 | Low-Medium | `src/auth/secureStorage.ts` | The iOS Keychain survives uninstalling the app. After a reinstall, `_layout.tsx` restores the previous user's session automatically. | On first launch, if a marker file in `documentDirectory` is missing, clear both tokens and then write the marker. |
| B10 | Medium | `src/constants/api.ts:5-6`; the fallbacks at `app/(tabs)/deliveries.tsx:27`, `app/(tabs)/projects.tsx:38`, `src/api/reports.ts:36` use port 3000 instead of 3001 | If `EXPO_PUBLIC_API_URL` is missing, the app silently targets `http://10.0.2.2`, an Android-emulator alias that does not exist on iOS. The ports are also inconsistent. | Use a single fallback, only when `__DEV__`. In release builds, show a clear "API URL not configured" error instead. |
| B11 | Low (lead/deps) | `package.json` | `expo-intent-launcher` (Android-only) is a dependency but is never imported. | Remove the dependency (a package.json change, so a lead decision). |
| B12 | Low | `app/(tabs)/projects.tsx:820`, `:866` | `Sharing.shareAsync` passes only `mimeType` and `dialogTitle`, which are Android/web options. | Add `UTI: 'com.adobe.pdf'` so iOS offers the right "Open in" and "Save to Files" targets. |
| B13 | Low | `src/utils/offlineQueue.ts:11`, `src/api/drawings.ts:21` | The offline queue and the drawings cache are written to `documentDirectory`, which is included in iCloud and iTunes backups by default. They hold company data. The drawings cache is also not cleared on sign-out. | Move the cache to `cacheDirectory`. Clear the per-user caches in `clearAuth`. |
| B14 | Medium (accessibility) | All of `app/` and `src/` (0 occurrences of `accessibilityLabel` or `accessibilityRole`) | Icon-only and emoji buttons are unlabeled for VoiceOver. | Add `accessibilityRole="button"` and `accessibilityLabel` to touchables, starting with the tab bar, the app-bar icons and the form actions. |
| B15 | Low | `app/login.tsx:16-37`, `app/_layout.tsx:28-56` | The push token is registered only when the user signs in with the form. Restored sessions never re-register, so a token that changes after an iOS restore or reinstall is never sent to the API. | Call the registration (idempotent on the server) after the bootstrap restores a session. |

---

## 6. ANDROID-BUILD-CONFIG

Changes to Android build configuration in this branch (`app.json` / `eas.json`):

| Change | Why / evidence |
|---|---|
| Removed `"NOTIFICATIONS"` from `android.permissions` | `android.permission.NOTIFICATIONS` is not a real Android permission. The real one, `POST_NOTIFICATIONS` (Android 13+), is declared by the `expo-notifications` library manifest. |
| Removed `READ_EXTERNAL_STORAGE` and added it to `android.blockedPermissions` | Nothing reads shared storage. Downloads go to the app cache, photos come only from the camera, and sharing uses FileProvider content URIs. `expo-image-picker` and `expo-file-system` declare it in their library manifests, so blocking it (`tools:node="remove"`) is the only way to keep it out of the merged manifest. |
| Added `android.permission.RECORD_AUDIO` to `blockedPermissions`, and set `microphonePermission: false` in the image-picker plugin | The image-picker plugin adds `RECORD_AUDIO` by default (for video). The app captures still images only. |
| Added `android.permission.SYSTEM_ALERT_WINDOW` to `blockedPermissions` | Expo's prebuild adds this "display over other apps" permission by default. The app never draws overlays, and it is a sensitive permission for Play review. |
| **Kept** `WRITE_EXTERNAL_STORAGE` | It looks deprecated but is required: `expo-image-picker` 15.1 `ensureCameraPermissionsAreGranted()` (in `ImagePickerModule.kt`) needs both `CAMERA` and `WRITE_EXTERNAL_STORAGE` granted on Android 12L and earlier (API < 33). Blocking it would break delivery-photo capture on those devices. On SDK 58 the `expo-image-picker` 58 manifest declares it with `android:maxSdkVersion="32"`, and the resolved manifest keeps that limit, so Android 13+ never sees it. |
| Kept `CAMERA`, `VIBRATE`, `RECEIVE_BOOT_COMPLETED`, `ACCESS_NETWORK_STATE`, `INTERNET` | These are normal (install-time) or required permissions. Correction to `docs/store/PERMISSIONS.md`: the offline queue does **not** use NetInfo. `ACCESS_NETWORK_STATE` is kept as a harmless normal permission and is not justified as a feature. |
| `eas.json`: `development`/`preview` read `EXPO_PUBLIC_API_URL` from the EAS environment (section 4); `preview` still builds an APK (`android.buildType: apk`); `production` unchanged (AAB, `autoIncrement`) | |

The resolved AndroidManifest permissions (from `expo config --type introspect`):
- Active: `INTERNET, VIBRATE, WRITE_EXTERNAL_STORAGE (maxSdkVersion 32), CAMERA, RECEIVE_BOOT_COMPLETED, ACCESS_NETWORK_STATE`
- Blocked: `READ_EXTERNAL_STORAGE, SYSTEM_ALERT_WINDOW, RECORD_AUDIO`

Library-declared permissions such as `POST_NOTIFICATIONS` are merged in at Gradle build time and are not part of this view.

Android status after the SDK 58 upgrade:
- **Google Play target API level: resolved by the SDK 58 upgrade (VERIFIED-STATIC).** SDK 58 / React Native 0.88 builds with `targetSdk 36`, `compileSdk 37`, `minSdk 24` (`react-native/gradle/libs.versions.toml`, also the defaults in `expo-modules-autolinking`'s `ExpoRootProjectPlugin.kt`). Google Play requires API 36 for new apps and app updates from 31 August 2026 (existing apps: API 35). SDK 51 targeted API 34. A real Gradle build has not been run here (UNVERIFIED-RUNTIME until the first EAS Android build).
- **R8 is on by default in SDK 58 release builds** (UNVERIFIED-RUNTIME). Libraries that rely on reflection can need keep rules. None of this app's dependencies is known to, but only a release build (`eas build -p android --profile preview`) and a smoke test prove it.
- **Edge-to-edge is always on** (SDK 54+). The app bars and tab bar already pad by the safe-area insets (section 2, item 24). In Expo Go on the Android 16 emulator the login screen draws correctly edge-to-edge (section 7). A standalone build has not been checked.
- `google-service-account.json` is now listed in the root `.gitignore` (#7).

---

## 7. Validation log

### EAS simulator profile and config checks (`feat/ios-eas-build`, 2026-11-07, Windows 11)

| Command (cwd `packages/mobile`) | Result |
|---|---|
| `npx expo config --type public --json` | Exit 0. `bundleIdentifier com.constructos.app`, `buildNumber 1`, `supportsTablet false`, `privacyManifests` present. |
| `npx expo config --type introspect --json` | Exit 0. Purpose strings exactly Camera, PhotoLibrary, PhotoLibraryAdd, FaceID (no Microphone, no Location); `ITSAppUsesNonExemptEncryption=false`; entitlements `{ aps-environment: development }` only (no `associated-domains`). |
| `mergePrivacyInfo({}, ios.privacyManifests)` from `@expo/config-plugins` (the function prebuild uses) | Produces a `PrivacyInfo.xcprivacy` with UserDefaults CA92.1, FileTimestamp C617.1/0A2A.1/3B52.1, SystemBootTime 35F9.1, DiskSpace E174.1/85F4.1, `NSPrivacyTracking false`. |
| `CI=1 npx expo prebuild --platform ios --no-install` (in a throwaway copy) | **Not possible on Windows.** Expo CLI prints "Skipping generating the iOS native project files. Run npx expo prebuild again from macOS or Linux" and exits. The generated `Info.plist` and entitlements were therefore checked with `introspect` only. |
| `npx expo-doctor@latest` | 19/20 checks pass; the one finding is the known duplicate `react` (section 2, item 9). |
| `eas config --platform ios --profile <p>` for `preview-simulator`, `preview`, `development`, `production` | All resolve. `preview-simulator`: `distribution internal`, `simulator true`, `environment preview`. `production`: `distribution store`, `autoIncrement`, `env` = `EXPO_PUBLIC_API_URL` only. |
| `eas env:list --environment preview / development / production` (names only) | **No variables in any environment.** A `preview` or `preview-simulator` build made today would show the "API URL not configured" error. Set the variable first (section 8.2, step 2). |
| `eas whoami` | Signed in as `dalmarmudu` (matches `app.json > owner`). EAS CLI 18.7.0 installed; 27.5.0 is current. |
| Repository scan for Apple credentials | None committed. No `*.p8`, `*.p12`, `*.mobileprovision`, `*.cer` or `credentials.json` is tracked, and the root `.gitignore` covers `*.p8`, `*.p12`, `*.mobileprovision` and `credentials.json`. `eas.json > submit.production.ios` holds only the three placeholders. Whether EAS already stores iOS credentials on its servers was not checked (`eas credentials` is interactive and can ask for an Apple sign-in). |
| `eas build`, `eas build:run`, `eas credentials`, `eas device:create`, `eas env:create` | **Not run.** |
| iOS Simulator / device | **Not run (no Mac). iOS runtime is NOT verified.** |


### SDK 58 upgrade (`feat/ios-sdk-upgrade`, 2026-11-07, Windows 11)

| Command | Result |
|---|---|
| `npx expo install --check` / `--fix` | All packages at the SDK 58 versions (only `@babel/core` and `typescript` needed a bump after the manual update). |
| `npx tsc --noEmit -p .` (packages/mobile, TypeScript 6.0) | Exit 0. |
| `npx expo-doctor@latest` (1.21.6) | 19/20 checks passed; the remaining one is the intended `react@18.2.0` at the repo root for `packages/web` (section 2, item 9). |
| `npx expo config --type introspect --json` | Purpose strings exactly Camera, PhotoLibrary, PhotoLibraryAdd, FaceID with the app-specific texts; `ITSAppUsesNonExemptEncryption=false`; `aps-environment` present; scheme `constructos`; Android manifest removes `READ_EXTERNAL_STORAGE`, `RECORD_AUDIO`, `SYSTEM_ALERT_WINDOW` (`tools:node="remove"`) and keeps `CAMERA`. |
| `npx expo export --platform android` and `--platform ios` (output outside the repo) | Both succeed (Hermes bundles, about 4.2 MB each). The source maps list exactly one `react` (`packages/mobile/node_modules/react`, version 19.3.0) and one `react-native`. Control run with `experiments.autolinkingModuleResolution: false`: the bundle also contains the repo-root `node_modules/react` (React 18), which is why the flag is set explicitly. |
| `packages/web`: `npx tsc --noEmit -p .` and `npx jest --ci` on the same install | tsc exit 0; 27/27 suites, 626/626 tests pass. `packages/web` still resolves `react`/`react-dom` 18.2.0. |
| `eas whoami` | Signed in as `dalmarmudu`. |
| `eas build`, `eas credentials`, `eas submit`, `eas device:create`, `eas env:create` | **Not run** (owner-only; section 3). |
| iOS Simulator / device | **Not run** (no Mac). Everything iOS-specific above is VERIFIED-STATIC at most. |

### Android runtime in Expo Go 58.0.5 (emulators, 2026-11-07)

Metro (`npx expo start --go --port 8083`) served the app from this branch. Expo Go 58.0.5 came from the Expo versions API.

| Emulator | Result |
|---|---|
| `QA_API34`: Android 14, API 34 | The bundle loaded (2006 modules) and the Expo Go header showed "SDK version: 58.0.0". The login screen rendered: header, email/password fields, Sign In, Request Access, and "API: http://10.0.2.2:3001/api/v1". Typing into the email field worked. logcat: **0 `FATAL EXCEPTION`**. The only JS warnings were Expo Go's "remote push unavailable on Android" notices. Expo Go on Android 14 keeps the navigation-bar area outside the app window (the app window ends 63 px above the bottom), so the area below the content is Expo Go's, not the app's. |
| `Medium_Phone_API_36.0`: Android 16, API 36 | Same result: login screen rendered edge-to-edge, typing worked, **0 `FATAL EXCEPTION`**, and no "Unable to attach a rootView / UIManager is not properly initialized" error. That error is the startup crash Expo Go 2.31.2 (SDK 51) had on this emulator. On the first launch the bundle download stalled at 99.9 %; a relaunch loaded it. |

Not done: signing in. Port 3001 was in use by a process this run did not start, so no API was started from this branch, and the dashboard and tabs were not exercised on SDK 58.

### iOS-readiness branch (#5, SDK 51)

| Command | Result |
|---|---|
| `npx expo config --type public` (through the shared lock runner) | Succeeded. `bundleIdentifier: 'com.constructos.app'`. |
| `npx expo config --type introspect --json` | Succeeded. Purpose strings, encryption flag, entitlements and Android permissions were checked as described in sections 1 and 6. The same checks fail when run against the `main` config (control run). |
| `@expo/eas-json` 18.6.0 (from EAS CLI 18.7.0): resolve every build profile on iOS and Android | All four profiles (`development`, `preview`, `preview-simulator`, `production`) are valid. The iOS submit profile fails validation because of the placeholders (expected; section 1). |
| `npx expo-doctor@1` (1.21.6) | 17/17 checks passed. |

---

## 8. iOS build procedures

**iOS runtime: NOT verified.** Nobody has run these commands yet. They are written from the EAS
documentation and from the resolved config in section 7.

### 8.1 Privacy manifest (`ios.privacyManifests`)

Apple rejects uploads (ITMS-91053) when the app binary uses a "required-reason" API that no
privacy manifest declares. The Expo SDK 58 prebuild template has no app-level
`PrivacyInfo.xcprivacy`, so `app.json > ios.privacyManifests` now declares the union of what the
linked native modules use:

| API category | Reasons | Declared by (installed SDK 58 pods) |
|---|---|---|
| UserDefaults | CA92.1 | React-Core, expo-constants, expo-notifications; also used by `expo-sharing`, which has no manifest of its own |
| FileTimestamp | C617.1, 0A2A.1, 3B52.1 | React-Core, cxxreact, expo-file-system, expo-application |
| SystemBootTime | 35F9.1 | react/timing, expo-device |
| DiskSpace | E174.1, 85F4.1 | expo-file-system |

`NSPrivacyTracking` is `false` and there are no tracking domains: the app has no ads or analytics
SDK. `NSPrivacyCollectedDataTypes` is left empty in the manifest. **Owner:** the App Store
Connect "App Privacy" answers (account e-mail and name, photos the user uploads, push token, and
so on) are still a separate owner task. Re-check this table when a native dependency is added.

### 8.2 Simulator build on EAS (no Apple account needed)

What it needs: an Expo account (the CLI is signed in as `dalmarmudu`) and a Mac with Xcode to run
the result. No Apple Developer membership, no certificates, no device registration. It uses one
build from the EAS free plan's monthly allowance.

1. Update the CLI: `npm install -g eas-cli@latest`, then `cd packages/mobile && eas whoami`.
2. **Set the API URL for the `preview` environment** (none is set today, section 7):
   ```bash
   eas env:create --environment preview --name EXPO_PUBLIC_API_URL \
     --value "https://<dev-or-staging-api-host>/api/v1" --visibility plaintext
   eas env:list --environment preview
   ```
   Use an HTTPS host that the Mac can reach (`DEV-API-ACCESS.md`; Tailscale Serve is the
   recommended option). The same variable is used by device `preview` builds, so do not set it to
   `http://localhost:3001/api/v1` unless you will change it back before a device build (it only
   works because the Simulator shares the Mac's network).
3. Build:
   ```bash
   eas build -p ios --profile preview-simulator
   ```
   In the log, check for `Environment variables ... loaded from the "preview" environment on EAS: EXPO_PUBLIC_API_URL`.
   If that line is missing, cancel the build.
4. Run it, on a Mac with Xcode and at least one iOS 16.4+ simulator runtime:
   - Easiest: `eas build:run -p ios --latest` (downloads the build, boots a simulator, installs and launches it).
   - Manual: download the `.tar.gz` from the build page (or `eas build:list -p ios --limit 1` for the URL), then:
     ```bash
     tar -xzf <build>.tar.gz          # gives ConstructOS.app
     open -a Simulator                # boot any iPhone simulator
     xcrun simctl install booted ConstructOS.app
     xcrun simctl launch booted com.constructos.app
     ```
     Dragging `ConstructOS.app` onto the Simulator window also installs it.
5. Run the smoke test in section 9. On the Simulator, push registration is skipped by design
   (`Device.isDevice` is false) and there is no camera, so those items need a device build.

### 8.3 Device build, internal distribution (ad hoc)

Prerequisites, all owner-only: section 3, steps 1 to 6 (Apple Developer Program membership,
Team ID, bundle ID with Push Notifications, registered test iPhones, API URL, APNs key).

**How EAS-managed credentials work.** On the first `eas build -p ios`, EAS CLI asks for the
owner's Apple ID and password (plus the two-factor code) and signs in to the Apple Developer portal
from the owner's machine. It then creates, or reuses, the distribution certificate and an ad hoc
provisioning profile listing the registered UDIDs, registers the bundle ID if needed, and stores
the certificate and profile on Expo's servers for later builds. Nothing is written to the
repository. The alternative is an App Store Connect API key (`.p8`, ignored by git) for
non-interactive builds. `credentials.json` (local credentials mode) is also ignored by git and is
not used here.

1. `cd packages/mobile && eas device:create`, open the link on each test iPhone, then `eas device:list`.
2. **OWNER-ONLY STEP:** `eas build -p ios --profile preview`. This is the step that signs in to
   Apple and creates the signing credentials. Answer "Yes" to letting EAS manage credentials and
   to setting up push notifications (APNs key).
3. Open the build page link or QR code on a registered iPhone and install. Turn on
   Settings → Privacy & Security → Developer Mode if iOS asks, then restart the phone.
4. Run the smoke test in section 9, including the device-only items.

`development` builds stay blocked until `expo-dev-client` is added (section 2, item 10).
TestFlight is section 3, step 9.

## 9. iOS smoke-test checklist

Mirrors the Android checklist in `ANDROID-LOCAL-BUILD.md`. Record the device or simulator model,
the iOS version and the build ID next to each result. **Sim** = can be done on the Simulator;
**Device** = needs the ad hoc build.

| # | Step | Expected | Where |
|---|---|---|---|
| 1 | Sign in with a wrong password | "Invalid email or password", still on the login screen | Sim |
| 2 | Sign in with a correct test account | "My Day" dashboard | Sim |
| 3 | Open Deliveries, Attendance and Schedule | Each tab loads data, no red error box; the tab bar clears the home indicator | Sim |
| 4 | Swipe the app away in the app switcher and relaunch | Still signed in, back on My Day | Sim |
| 5 | Profile → Log Out, then relaunch | Login screen, and still signed out after the relaunch | Sim |
| 6 | Deliveries → add a photo | The camera prompt shows the ConstructOS camera text from `app.json`; Allow opens the camera; the photo uploads. No photo-library prompt appears (the app never asks for it) | Device (the Simulator has no camera) |
| 7 | Deny the camera prompt, then try again | A clear message, no crash; Settings → ConstructOS → Camera can turn it back on | Device |
| 8 | Reports → download a PDF and a CSV; Projects → open a drawing PDF | The share sheet opens with the file; "Save to Files" works; "Save Image" (if offered) shows the photo-add prompt text | Sim (share sheet) / Device |
| 9 | First sign-in on a fresh install | The notification permission prompt appears once; after Allow, a test push from the API arrives | Device (skipped on the Simulator by design) |
| 10 | Tap a notification while the app is closed | The app opens on the linked screen | Device |
