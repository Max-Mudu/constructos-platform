# ConstructOS — App Permissions Justifications

This document explains every permission the app requests and why it is necessary, in the format required by Google Play and Apple App Store review teams.

---

## Android Permissions

### CAMERA
**Usage:** Delivery record photo capture  
**Justification:** Users photograph delivery receipts and site materials when logging a delivery record. The camera is only accessed when the user explicitly taps "Add Photo" within the delivery form. No photos are taken automatically.  
**Required by:** `expo-image-picker`

### WRITE_EXTERNAL_STORAGE
**Usage:** Delivery photo capture on Android 12L and earlier  
**Justification:** `expo-image-picker` requires this permission, together with CAMERA, before it opens the camera on Android versions below 13 (API < 33). It has no effect on newer Android versions. The app does not write to shared storage: report downloads and photos stay in the app's private cache and are shared through the system share sheet.  
**Required by:** `expo-image-picker`

### READ_EXTERNAL_STORAGE: not requested (blocked)
The app does not read shared storage. The permission is declared by `expo-image-picker` and `expo-file-system`, so it is listed in `android.blockedPermissions` to remove it from the merged manifest. `RECORD_AUDIO` and `SYSTEM_ALERT_WINDOW` are blocked in the same way, because the app records no audio and draws no overlays.

### POST_NOTIFICATIONS (Android 13+)
**Usage:** Push notifications for work alerts  
**Justification:** The app delivers real-time job alerts — new delivery confirmations, attendance reminders, invoice approvals, and supervisor messages. Users are prompted to grant this permission on first launch.  
**Required by:** `expo-notifications`

### VIBRATE
**Usage:** Notification vibration  
**Justification:** Standard companion permission to POST_NOTIFICATIONS for haptic feedback on incoming alerts.  
**Required by:** `expo-notifications`

### RECEIVE_BOOT_COMPLETED
**Usage:** Restore scheduled notifications after device restart  
**Justification:** Allows the notification system to reschedule any pending local notifications after the device reboots.  
**Required by:** `expo-notifications`

### ACCESS_NETWORK_STATE
**Usage:** Network connectivity (no user-facing feature)  
**Justification:** A normal (install-time) permission with no user prompt, kept for networking libraries. The offline queue itself does not read connectivity state: it retries queued attendance and labour writes when the app returns to the foreground.  
**Required by:** platform networking (normal permission)

### INTERNET
**Usage:** API communication  
**Justification:** Core app functionality. All attendance, labour, delivery, and notification data is sent to and received from the ConstructOS API over HTTPS.

---

## iOS Permissions (Info.plist)

### NSCameraUsageDescription
**String:** "ConstructOS uses the camera when you add a photo to a delivery record, for example to photograph a delivery receipt or the delivered materials."  
**Trigger:** When user taps "Add Photo" in the delivery form  
**Required by:** `expo-image-picker` (set through the plugin's `cameraPermission` option in `app.json`)

### NSPhotoLibraryUsageDescription
**String:** "ConstructOS only accesses photos that you choose to attach to a delivery record. It does not browse or upload your photo library on its own."  
**Trigger:** None today. The app never requests photo-library access. The key is declared because `expo-image-picker` links the Photos API, and Apple's upload check (ITMS-90683) expects a purpose string for it.  
**Required by:** `expo-image-picker` (plugin `photosPermission` option)

### NSPhotoLibraryAddUsageDescription
**String:** "ConstructOS saves a file to your photo library only when you choose Save Image from the share sheet."  
**Trigger:** Only if the user picks "Save Image" in the iOS share sheet opened by `expo-sharing`  
**Required by:** iOS share sheet (`expo-sharing`)

### NSFaceIDUsageDescription
**String:** "ConstructOS keeps your sign-in in the iOS Keychain. Face ID is used only if a protected sign-in item on this device needs to be unlocked."  
**Trigger:** None today. The app never stores biometric-protected items.  
**Required by:** `expo-secure-store` (plugin `faceIDPermission` option)

### Not declared
- NSLocationWhenInUseUsageDescription: removed, because the app does not use location.
- NSMicrophoneUsageDescription: removed through `expo-image-picker` `microphonePermission: false`, because the app captures still images only.

### Export compliance
`ITSAppUsesNonExemptEncryption = false` (`ios.config.usesNonExemptEncryption`). The app uses only OS-provided HTTPS and Keychain encryption. See `docs/IOS-READINESS.md`.

---

## Permission Not Requested

| Permission | Reason Not Needed |
|---|---|
| Contacts | App does not integrate with device contacts |
| Microphone | No audio recording features (blocked on Android, no iOS purpose string) |
| Bluetooth | No hardware device pairing |
| Face ID / Touch ID | Authentication uses email/password + JWT tokens |
| Background Location | Location is only checked at moment of check-in, not continuously |
| Location (any) | The app does not access device location |

---

## Summary for Store Review

All permissions are necessary for core app functionality:
- **Camera** — delivery documentation (user-initiated only)
- **Storage (write, Android 12L and earlier only)** — required by the camera picker
- **Notifications** — job alerts (user grants on first launch)
- **Network state** — offline queue management
- **Internet** — core API communication

No permissions are requested preemptively or for purposes beyond what is described.
