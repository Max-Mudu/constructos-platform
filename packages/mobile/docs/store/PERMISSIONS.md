# ConstructOS — App Permissions Justifications

This document explains every permission the app requests and why it is necessary, in the format required by Google Play and Apple App Store review teams.

---

## Android Permissions

### CAMERA
**Usage:** Delivery record photo capture  
**Justification:** Users photograph delivery receipts and site materials when logging a delivery record. The camera is only accessed when the user explicitly taps "Add Photo" within the delivery form. No photos are taken automatically.  
**Required by:** `expo-image-picker`

### READ_EXTERNAL_STORAGE / WRITE_EXTERNAL_STORAGE
**Usage:** Report file downloads  
**Justification:** When users export attendance, labour, or delivery reports as PDF or CSV, the files are saved to device storage so they can be accessed in Files, shared via email, or printed. Required on Android API < 29; scoped storage used on Android 10+.  
**Required by:** `expo-file-system`

### NOTIFICATIONS / POST_NOTIFICATIONS (Android 13+)
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
**Usage:** Offline queue detection  
**Justification:** The app detects connectivity state to decide whether to queue attendance and labour writes offline or submit immediately. No network data is transmitted beyond what is needed for app operation.  
**Required by:** React Native NetInfo / offline queue

### INTERNET
**Usage:** API communication  
**Justification:** Core app functionality. All attendance, labour, delivery, and notification data is sent to and received from the ConstructOS API over HTTPS.

---

## iOS Permissions (Info.plist)

### NSCameraUsageDescription
**String:** "ConstructOS uses the camera to photograph delivery receipts and site materials."  
**Trigger:** When user taps "Add Photo" in the delivery form  
**Required by:** `expo-image-picker`

### NSPhotoLibraryUsageDescription
**String:** "ConstructOS saves delivery photos and downloaded reports to your photo library."  
**Trigger:** When user saves a delivery photo or exports a report to Photos  
**Required by:** `expo-image-picker`, `expo-file-system`

### NSPhotoLibraryAddUsageDescription
**String:** "ConstructOS saves delivery photos to your photo library."  
**Trigger:** When user chooses to save a captured delivery photo  
**Required by:** `expo-image-picker`

### NSLocationWhenInUseUsageDescription
**String:** "ConstructOS may use your location to verify on-site attendance check-ins."  
**Trigger:** Only if location-verified attendance is enabled by the company administrator  
**Required by:** Attendance verification feature (optional; controlled server-side)

---

## Permission Not Requested

| Permission | Reason Not Needed |
|---|---|
| Contacts | App does not integrate with device contacts |
| Microphone | No audio recording features |
| Bluetooth | No hardware device pairing |
| Face ID / Touch ID | Authentication uses email/password + JWT tokens |
| Background Location | Location is only checked at moment of check-in, not continuously |
| Precise Location | Approximate location sufficient for site verification |

---

## Summary for Store Review

All permissions are necessary for core app functionality:
- **Camera** — delivery documentation (user-initiated only)
- **Storage** — report file downloads (user-initiated only)
- **Notifications** — job alerts (user grants on first launch)
- **Network state** — offline queue management
- **Internet** — core API communication

No permissions are requested preemptively or for purposes beyond what is described.
