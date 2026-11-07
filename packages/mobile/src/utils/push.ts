/**
 * Expo push token helpers shared by login (register) and logout (unregister).
 */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants, { ExecutionEnvironment } from 'expo-constants';

function easProjectId(): string | undefined {
  return (
    (Constants.expoConfig?.extra?.eas?.projectId as string | undefined) ??
    Constants.easConfig?.projectId ??
    undefined
  );
}

/**
 * Android 8+ delivers notifications only through a channel, and Android 13+
 * shows the POST_NOTIFICATIONS prompt only once a channel exists. The API
 * sends without a channelId, so Expo routes to the "default" channel.
 */
async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name:       'Default',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

/**
 * Expo Go on Android no longer supports remote push (removed in SDK 53); the
 * push-token APIs throw there. Development and store builds are unaffected.
 */
function remotePushUnavailable(): boolean {
  return (
    Platform.OS === 'android' &&
    Constants.executionEnvironment === ExecutionEnvironment.StoreClient
  );
}

/** The current device's Expo push token, without prompting. Null if unavailable. */
export async function getExpoPushToken(): Promise<string | null> {
  if (!Device.isDevice || remotePushUnavailable()) return null;
  const projectId = easProjectId();
  const tokenData = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  return tokenData.data;
}

/**
 * Asks for notification permission (if not yet decided) and returns the Expo
 * push token, or null on simulators/emulators or when permission is denied.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice || remotePushUnavailable()) return null;

  await ensureAndroidChannel();

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return null;

  return getExpoPushToken();
}
