/**
 * Whether opening the camera can be attempted on this device.
 *
 * On iOS, expo-image-picker sets the picker's source to the camera without
 * first asking UIKit whether a camera exists. Where there is none (the iOS
 * Simulator) UIKit raises a native exception ("Source type 1 not available")
 * that JavaScript cannot catch, and the app is terminated. So the caller must
 * not get that far: it shows its "Camera Unavailable" message instead.
 *
 * Everywhere else the attempt is safe: a failure to open the camera comes
 * back as a rejected promise, which the caller already handles.
 *
 * Pure (no React Native imports) so it can be exercised with plain Node.
 */
export function cameraCanOpen(env: { platformOS: string; isDevice: boolean }): boolean {
  return !(env.platformOS === 'ios' && !env.isDevice);
}
