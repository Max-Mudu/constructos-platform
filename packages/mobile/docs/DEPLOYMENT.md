# ConstructOS — EAS Deployment Runbook

## Prerequisites

1. **Expo account** — create at https://expo.dev
2. **EAS CLI** — `npm install -g eas-cli`
3. **Apple Developer account** — for iOS builds/submission
4. **Google Play Console account** — for Android submission
5. **Replace placeholders** in `eas.json` and `app.json` before running any build

## One-time Setup

### 1. Login to EAS

```bash
eas login
```

### 2. Link project to EAS

```bash
cd packages/mobile
eas init
```

Copy the `projectId` printed to `app.json > extra.eas.projectId`.

### 3. Configure credentials

```bash
# iOS — EAS manages provisioning profiles automatically
eas credentials --platform ios

# Android — generate upload keystore
eas credentials --platform android
```

---

## Building

### Development build (internal testing, dev server)

```bash
eas build --profile development --platform android
# or
eas build --profile development --platform ios
```

Install on device, then start the dev server:

```bash
npx expo start --dev-client
```

### Preview APK (Android QA)

```bash
eas build --profile preview --platform android
```

Download and install the `.apk` directly on Android devices.

### Production build

```bash
# Both platforms
eas build --profile production --platform all

# Single platform
eas build --profile production --platform android
eas build --profile production --platform ios
```

`autoIncrement: true` in `eas.json` bumps `versionCode` / `buildNumber` automatically.

---

## Submitting

### Android (Google Play)

1. Obtain a Google service account JSON key from Google Play Console.
2. Place it at `packages/mobile/google-service-account.json` (gitignored).
3. Ensure `app.json > android.package` matches Play Console.
4. Submit:

```bash
eas submit --profile production --platform android
```

First submission must be done manually through Play Console (upload the AAB).
Subsequent submissions via EAS submit go to the **internal** track — promote in Play Console.

### iOS (App Store Connect)

1. Set `eas.json > submit.production.ios.appleId` to your Apple ID.
2. Set `ascAppId` to the numeric App ID from App Store Connect.
3. Set `appleTeamId` to your 10-character Apple Team ID.
4. Submit:

```bash
eas submit --profile production --platform ios
```

---

## Environment Variables

| Variable | Development | Production |
|---|---|---|
| `EXPO_PUBLIC_API_URL` | `http://10.0.2.2:3000/api/v1` | `https://api.your-domain.com/api/v1` |

Update `EXPO_PUBLIC_API_URL` in `eas.json > build.production.env` before production builds.

---

## OTA Updates (EAS Update)

After installing `expo-updates`:

```bash
eas update --channel production --message "Hotfix: ..."
```

Users on production builds automatically receive JS-only updates.

---

## Checklist Before First Store Release

- [ ] Replace `https://api.your-domain.com/api/v1` with real API URL in `eas.json`
- [ ] Replace `YOUR_EAS_PROJECT_ID` in `app.json`
- [ ] Replace `your-apple-id@example.com` in `eas.json`
- [ ] Replace `YOUR_APP_STORE_CONNECT_APP_ID` in `eas.json`
- [ ] Replace `YOUR_APPLE_TEAM_ID` in `eas.json`
- [ ] Place `google-service-account.json` in `packages/mobile/`
- [ ] Confirm `android.package` and `ios.bundleIdentifier` are registered
- [ ] Test production build on real device before submission
- [ ] Complete content rating questionnaire in Play Console
- [ ] Complete App Store review information in App Store Connect
