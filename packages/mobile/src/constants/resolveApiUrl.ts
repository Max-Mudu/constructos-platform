/**
 * Pure API base URL resolution — no React Native imports, so the rules can be
 * checked in plain Node. `src/constants/api.ts` feeds it the runtime inputs.
 *
 * Order:
 *  1. EXPO_PUBLIC_API_URL, when set and non-empty (EAS builds, `.env`).
 *  2. Development only: the LAN host Metro was reached on (expo-constants
 *     hostUri / debuggerHost), so a physical phone on the same Wi-Fi talks to
 *     the API on the developer's machine at http://<lan-host>:3001/api/v1.
 *  3. Development only: platform default — Android emulator -> 10.0.2.2 (the
 *     host loopback alias), iOS simulator / USB device with `adb reverse` ->
 *     localhost.
 *  4. Release build without EXPO_PUBLIC_API_URL: NO URL (source 'missing').
 *     The app then refuses every request with a visible configuration error
 *     instead of silently calling a developer address.
 *
 * A production URL is never used as an implicit dev fallback.
 */

export const API_PORT = 3001;
export const API_PATH = '/api/v1';

export type ApiUrlSource = 'env' | 'dev-host' | 'platform-default' | 'missing';

export interface ApiUrlInputs {
  /** Raw EXPO_PUBLIC_API_URL value (may be undefined or blank). */
  envUrl:     string | undefined;
  /** `__DEV__` */
  isDev:      boolean;
  /** `Platform.OS` */
  platformOS: string;
  /** `expo-device` isDevice — false on emulators / simulators. */
  isDevice:   boolean;
  /** Metro host as "host:port" (Constants.expoConfig.hostUri or debuggerHost). */
  devHostUri: string | undefined | null;
}

export interface ResolvedApiUrl {
  url:    string;
  source: ApiUrlSource;
}

// Tunnel / proxy hosts forward only the Metro port, never the API port.
const TUNNEL_HOST_RE = /(\.exp\.direct|\.ngrok\.io|\.ngrok-free\.app|\.ngrok\.app)$/i;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** Extracts the bare host from "host:port", "[ipv6]:port" or a URL-ish string. */
export function extractHost(hostUri: string | undefined | null): string | null {
  if (!hostUri) return null;
  let s = hostUri.trim();
  if (!s) return null;
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, ''); // strip scheme if present
  s = s.split('/')[0] ?? '';                     // strip path
  if (s.startsWith('[')) {
    const end = s.indexOf(']');
    return end > 0 ? s.slice(0, end + 1) : null;
  }
  const host = s.split(':')[0] ?? '';
  return host || null;
}

function platformDefault(platformOS: string, isDevice: boolean): string {
  // Android emulator reaches the host machine via 10.0.2.2. A physical Android
  // device without a LAN host can only use localhost via `adb reverse tcp:3001 tcp:3001`.
  if (platformOS === 'android' && !isDevice) return `http://10.0.2.2:${API_PORT}${API_PATH}`;
  return `http://localhost:${API_PORT}${API_PATH}`;
}

export function resolveApiBaseUrl(inputs: ApiUrlInputs): ResolvedApiUrl {
  const env = inputs.envUrl?.trim();
  if (env) return { url: env.replace(/\/+$/, ''), source: 'env' };

  if (!inputs.isDev) return { url: '', source: 'missing' };

  const host = extractHost(inputs.devHostUri);
  if (host && !TUNNEL_HOST_RE.test(host) && !LOOPBACK_HOSTS.has(host.toLowerCase())) {
    return { url: `http://${host}:${API_PORT}${API_PATH}`, source: 'dev-host' };
  }

  return { url: platformDefault(inputs.platformOS, inputs.isDevice), source: 'platform-default' };
}

/** True when a URL points at a non-local HTTPS host (i.e. a deployed server). */
export function isRemoteHttpsUrl(url: string): boolean {
  const m = /^https:\/\/([^/:?#]+)/i.exec(url);
  if (!m) return false;
  const host = (m[1] ?? '').toLowerCase();
  if (LOOPBACK_HOSTS.has(host)) return false;
  // RFC 1918 / link-local LAN addresses are local even over HTTPS.
  return !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(host);
}
