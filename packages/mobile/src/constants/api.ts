// API base URL.
// - EAS builds / `.env`: set EXPO_PUBLIC_API_URL (wins everywhere).
// - Local dev without it: derived from the LAN host Metro is served on, so a
//   physical phone on the same Wi-Fi reaches http://<your-pc-ip>:3001/api/v1.
//   Emulator/simulator fall back to 10.0.2.2 (Android) / localhost (iOS).
// The API must listen on 0.0.0.0 (packages/api does) and the host firewall
// must allow inbound TCP 3001 for physical devices.
// See ./resolveApiUrl.ts for the exact rules.
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { isRemoteHttpsUrl, resolveApiBaseUrl, ApiUrlSource } from './resolveApiUrl';

function metroHostUri(): string | undefined {
  // expoConfig.hostUri is set by @expo/cli in development (Expo Go and dev
  // clients); expoGoConfig.debuggerHost is the Expo Go equivalent.
  const fromConfig = Constants.expoConfig?.hostUri;
  if (fromConfig) return fromConfig;
  const goConfig = Constants.expoGoConfig as { debuggerHost?: string } | null;
  return goConfig?.debuggerHost ?? undefined;
}

const resolved = resolveApiBaseUrl({
  envUrl:     process.env.EXPO_PUBLIC_API_URL,
  isDev:      __DEV__,
  platformOS: Platform.OS,
  isDevice:   Device.isDevice,
  devHostUri: __DEV__ ? metroHostUri() : undefined,
});

export const API_BASE_URL: string = resolved.url;
export const API_URL_SOURCE: ApiUrlSource = resolved.source;
/** Server origin without the /api/v1 suffix. */
export const API_ORIGIN: string = API_BASE_URL.replace(/\/api\/v1$/, '');

if (__DEV__) {
  // Never point a dev session at a deployed server without saying so.
  if (isRemoteHttpsUrl(API_BASE_URL)) {
    console.warn(`[api] Development build is using a remote API: ${API_BASE_URL} (from EXPO_PUBLIC_API_URL)`);
  } else {
    console.log(`[api] API base URL: ${API_BASE_URL} (${API_URL_SOURCE})`);
  }
}
