# ConstructOS mobile: iOS readiness and build configuration

Last reviewed: 2026-11-06, on branch `feat/ios-readiness` (base `main` @ `149b484`).

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

Stack: Expo SDK 51 (`expo ~51.0.39`), React Native 0.74.5, expo-router 3.5,
iOS deployment target 13.4 (taken from `expo/Expo.podspec`), EAS CLI 18.7.0 installed locally.

---

## 1. Configuration changes made in this branch

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
| 9 | `expo-doctor` | VERIFIED-STATIC | `npx expo-doctor@1` (1.21.6): "17/17 checks passed. No issues detected!" |
| 10 | `development` profile is actually buildable | **BLOCKED (dependency)** | It sets `developmentClient: true`, but `expo-dev-client` is not in `package.json`. EAS will refuse or prompt to install it. Adding the dependency is a lead decision. Use `preview` or `preview-simulator` until then. |
| 11 | `channel` on profiles | VERIFIED-STATIC | Channels only matter with `expo-updates`, which is not installed. They are harmless. OTA updates are not available. |
| 12 | Apple's minimum Xcode/iOS SDK for App Store Connect uploads | UNVERIFIED-RUNTIME, **high risk for TestFlight** | Apple raises the minimum SDK for uploads every year: Xcode 16 / iOS 18 SDK from April 2025, with a further raise announced for 2026. Expo SDK 51 (React Native 0.74) predates both. Ad hoc builds are not subject to this rule. TestFlight and App Store uploads are, and may need an Expo SDK upgrade first. Check the current Apple requirement and the EAS build image for SDK 51 before planning TestFlight. |
| 13 | iOS 13.4+ deployment target | VERIFIED-STATIC | From `expo/Expo.podspec`. |

### Runtime behaviour (code reviewed read-only; nothing was run)

| # | Item | Status | Notes |
|---|---|---|---|
| 14 | Camera capture for delivery photos | VERIFIED-STATIC / UNVERIFIED-RUNTIME | `deliveries.tsx:335-341` asks for camera permission and then calls `launchCameraAsync`. Photo-library permission is never requested. |
| 15 | Push registration | VERIFIED-STATIC / UNVERIFIED-RUNTIME | `login.tsx:16-37` skips simulators (`Device.isDevice`) and passes `projectId` from `extra.eas.projectId`. It needs an APNs key in EAS (BLOCKED-OWNER, section 3 step 6). |
| 16 | Notification tap routing | UNVERIFIED-RUNTIME, **bug** | A tap that launches the app from closed is dropped (finding B2). |
| 17 | Session storage and refresh | VERIFIED-STATIC | Tokens are stored in the Keychain (`expo-secure-store`). A 401 triggers a single-flight refresh that queues other requests (`src/api/client.ts`). On iOS the Keychain survives uninstalling the app (finding B9). |
| 18 | Offline queue | VERIFIED-STATIC | A JSON file in `documentDirectory` is flushed when the app returns to the foreground (`AppState`). It uses no background task, so nothing runs while the app is suspended, which is correct for iOS. `documentDirectory` is included in iCloud backups (finding B13). |
| 19 | Live updates (SSE) | VERIFIED-STATIC, **bug** | iOS suspends the socket in the background. The provider reconnects after an error, but it never connects at all if the user was signed out when it mounted (finding B8). |
| 20 | Report PDF/CSV download (Reports tab) | **Fails on iOS (static analysis)** | It uses Android-only `getContentUriAsync` and then `Linking.openURL(file://…)` (finding B1). |
| 21 | Drawing PDF (Projects tab) | VERIFIED-STATIC / UNVERIFIED-RUNTIME | It uses `expo-sharing`, which works on iOS. The `mimeType` option is Android-only; iOS needs `UTI` (finding B12). |
| 22 | Android-only APIs called without a platform check | VERIFIED-STATIC | Only `FileSystem.getContentUriAsync` (B1). `expo-intent-launcher` is a dependency but is never imported (B11). There is no `ToastAndroid`, `BackHandler` or `PermissionsAndroid`. |
| 23 | Keyboard handling | **Red flag** | Five page-sheet modals and several forms have no `KeyboardAvoidingView`. iOS has no `adjustResize`, so the keyboard covers the fields (finding B5). |
| 24 | Safe areas | **Red flag** | App bars use a fixed `paddingTop: 56`, which is less than the Dynamic Island inset (59 pt or more). The tab bar's fixed height overrides the home-indicator inset (findings B3 and B4). |
| 25 | iPhone layout | **Red flag** | 7 to 9 bottom tabs for supervisor, PM, admin and finance roles. On a 375 pt wide iPhone each tab is about 41 pt wide, below the 44 pt minimum touch target (B3). |
| 26 | Accessibility (VoiceOver) | **Red flag** | There is no `accessibilityLabel` or `accessibilityRole` anywhere in `app/` or `src/`, and icons are emoji or icon-only (finding B14). |
| 27 | App Review: placeholder UI | **Risk** | The Profile screen has "coming soon" stubs (Privacy Policy, Terms, Help, Edit Profile) and three toggles that do nothing (finding B7). Guideline 2.1 (app completeness) and 5.1.1 (privacy). |
| 28 | Account deletion requirement (Guideline 5.1.1(v)) | VERIFIED-STATIC (not applicable today) | Accounts are created by the company admin, not in the app, so in-app deletion is not required. Revisit if self-signup is added. |
| 29 | API URL in iOS builds | **BLOCKED-OWNER** | Section 4. If the variable is missing, the app falls back to `http://10.0.2.2:3001/api/v1`, an address that exists only inside the Android emulator, so iOS cannot reach it (finding B10). |

---

## 3. Minimum owner steps for an internal iOS build

These are the steps for an ad hoc build (`preview`) and for internal TestFlight
(`production`). Nobody has run any of the EAS commands below in this review. Each one
signs in to Apple, creates credentials or uses EAS build minutes, so the owner runs them.

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
   No Apple account or credentials are needed. Download the `.tar.gz`, extract the `.app`, and drag it onto a booted Simulator.
9. **Internal TestFlight (instead of, or after, ad hoc):**
   1. Create the app record in App Store Connect (My Apps → + → New App) with the bundle ID from step 3. Its numeric **Apple ID** is the `ascAppId`.
   2. Replace the three placeholders in `eas.json > submit.production.ios` (`appleId`, `ascAppId`, `appleTeamId`). Until then `eas submit` fails validation (section 1).
   3. Fix the production API URL. The `production` profile still points at the offline Railway host (section 4).
   4. Run `eas build -p ios --profile production`, then `eas submit -p ios --profile production --latest`.
   5. In App Store Connect → TestFlight, add internal testers. They must be App Store Connect users on the team. Internal testing does not need Beta App Review.
   6. Check checklist item 12 first: an upload built with an outdated SDK is rejected by App Store Connect.
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

Line numbers refer to `main` @ `149b484`.

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
| **Kept** `WRITE_EXTERNAL_STORAGE` | It looks deprecated but is required: `expo-image-picker` 15.1 `ensureCameraPermissionsAreGranted()` (in `ImagePickerModule.kt`) needs both `CAMERA` and `WRITE_EXTERNAL_STORAGE` granted on Android 12L and earlier (API < 33). Blocking it would break delivery-photo capture on those devices. It has no effect on API 30+ in practice. |
| Kept `CAMERA`, `VIBRATE`, `RECEIVE_BOOT_COMPLETED`, `ACCESS_NETWORK_STATE`, `INTERNET` | These are normal (install-time) or required permissions. Correction to `docs/store/PERMISSIONS.md`: the offline queue does **not** use NetInfo. `ACCESS_NETWORK_STATE` is kept as a harmless normal permission and is not justified as a feature. |
| `eas.json`: `development`/`preview` read `EXPO_PUBLIC_API_URL` from the EAS environment (section 4); `preview` still builds an APK (`android.buildType: apk`); `production` unchanged (AAB, `autoIncrement`) | |

The resolved AndroidManifest permissions (from `expo config --type introspect`):
- Active: `INTERNET, VIBRATE, WRITE_EXTERNAL_STORAGE, CAMERA, RECEIVE_BOOT_COMPLETED, ACCESS_NETWORK_STATE`
- Blocked: `READ_EXTERNAL_STORAGE, SYSTEM_ALERT_WINDOW, RECORD_AUDIO`

Library-declared permissions such as `POST_NOTIFICATIONS` are merged in at Gradle build time and are not part of this view.

Android items that are still open:
- **Google Play target API level** (UNVERIFIED, high risk for Play uploads). Expo SDK 51 / React Native 0.74 targets API 34 (`targetSdkVersion = 34` in the RN template). Google Play has required API 35 for new apps and updates since 31 August 2025. Raising it needs `expo-build-properties` (not installed) or an Expo SDK upgrade, which are dependency changes and a lead decision. APKs for sideloading (`preview`) are not affected.
- **`google-service-account.json` is not git-ignored** (BLOCKED-OWNER / lead). `eas.json > submit.production.android.serviceAccountKeyPath` points to `./google-service-account.json`, and `DEPLOYMENT.md` used to say it was git-ignored, but neither the root `.gitignore` nor a `packages/mobile/.gitignore` lists it. Add it to a `.gitignore` (outside this workstream's files) before anyone puts the key in that folder.
- Nothing in this review was built or installed on Android either.

---

## 7. Validation log (this branch)

| Command | Result |
|---|---|
| `npx expo config --type public` (through the shared lock runner) | Succeeded. `bundleIdentifier: 'com.constructos.app'`. |
| `npx expo config --type introspect --json` | Succeeded. Purpose strings, encryption flag, entitlements and Android permissions were checked as described in sections 1 and 6. The same checks fail when run against the `main` config (control run). |
| `@expo/eas-json` 18.6.0 (from EAS CLI 18.7.0): resolve every build profile on iOS and Android | All four profiles (`development`, `preview`, `preview-simulator`, `production`) are valid. The iOS submit profile fails validation because of the placeholders (expected; section 1). |
| `npx expo-doctor@1` (1.21.6) | 17/17 checks passed. |
| `eas whoami` | Signed in as `dalmarmudu`. |
| `eas build`, `eas credentials`, `eas submit`, `eas device:create`, `eas env:create` | **Not run** (owner-only; section 3). |
