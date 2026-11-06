import * as SecureStore from 'expo-secure-store';

const ACCESS_TOKEN_KEY  = 'constructos_access_token';
const REFRESH_TOKEN_KEY = 'constructos_refresh_token';
const CACHED_USER_KEY   = 'constructos_cached_user';

export async function saveTokens(accessToken: string, refreshToken: string): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_TOKEN_KEY,  accessToken),
    SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken),
  ]);
}

export async function getAccessToken(): Promise<string | null> {
  return SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
}

export async function getRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
}

export async function clearTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
    SecureStore.deleteItemAsync(CACHED_USER_KEY),
  ]);
}

// ─── Cached profile (offline launch) ─────────────────────────────────────────
// The last /auth/me profile, so a cold start without connectivity can open the
// app (offline queue, cached drawings) instead of dropping to the login
// screen. It grants nothing: every API call is still authorised server-side.
// Removed together with the tokens.

export async function saveCachedUser(user: unknown): Promise<void> {
  try {
    await SecureStore.setItemAsync(CACHED_USER_KEY, JSON.stringify(user));
  } catch {
    // Non-fatal: only offline cold start depends on it.
  }
}

export async function getCachedUser<T>(): Promise<T | null> {
  try {
    const raw = await SecureStore.getItemAsync(CACHED_USER_KEY);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
