import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { getAccessToken, getRefreshToken, saveTokens } from '../auth/secureStorage';
import { useAuthStore } from '../store/auth.store';
import { API_BASE_URL, API_CONFIG_ERROR } from '../constants/api';

const BASE_URL = API_BASE_URL;

// ─── Axios instance ───────────────────────────────────────────────────────────

export const apiClient: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

// ─── Request interceptor — attach Bearer token ────────────────────────────────

apiClient.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  // Misconfigured release build: fail every call loudly instead of sending
  // requests (and tokens) to a relative or developer address.
  if (API_CONFIG_ERROR) throw new Error(API_CONFIG_ERROR);
  const token = await getAccessToken();
  if (token) {
    config.headers['Authorization'] = `Bearer ${token}`;
  }
  return config;
});

// ─── Response interceptor — auto-refresh on 401 ───────────────────────────────
//
// The API rotates refresh tokens and treats re-use of a revoked one as theft
// (it revokes EVERY session of the user). So:
//  - all concurrent 401s share ONE refresh call;
//  - a 401 for a request sent with an access token that has since been
//    replaced is simply retried with the current token (no second rotation);
//  - the session is ended only when the server rejects the refresh token
//    (400/401/403) — a network failure or 5xx keeps the user signed in, which
//    matters on sites with patchy coverage.

/** Auth endpoints whose 401 means "bad credentials", never "refresh me". */
const NO_REFRESH_PATH = /\/auth\/(login|register|refresh|logout|forgot-password|reset-password)(\?|$)/;

class SessionEndedError extends Error {}

let refreshPromise: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) throw new SessionEndedError('No refresh token');

  try {
    const res = await axios.post(`${BASE_URL}/auth/refresh`, { refreshToken }, { timeout: 15000 });
    const { accessToken, refreshToken: newRefresh } = res.data as {
      accessToken:  string;
      refreshToken: string;
    };
    await saveTokens(accessToken, newRefresh);
    return accessToken;
  } catch (err) {
    const status = (err as AxiosError).response?.status;
    if (status === 400 || status === 401 || status === 403) {
      throw new SessionEndedError('Refresh token rejected');
    }
    throw err; // offline / timeout / 5xx — keep the session
  }
}

function sharedRefresh(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = refreshAccessToken()
      .catch(async (err: unknown) => {
        // Runs once per failed refresh, not once per waiting request.
        // clearAuth clears secure storage AND resets Zustand state so the
        // UI navigates to login rather than showing a stale logged-in screen.
        if (err instanceof SessionEndedError) await useAuthStore.getState().clearAuth();
        throw err;
      })
      .finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;

    if (
      error.response?.status !== 401 ||
      !original ||
      original._retry ||
      NO_REFRESH_PATH.test(original.url ?? '')
    ) {
      return Promise.reject(error);
    }
    original._retry = true;

    // Another request may already have rotated the tokens since this one left.
    const current = await getAccessToken();
    if (current && original.headers?.['Authorization'] !== `Bearer ${current}`) {
      return apiClient(original); // request interceptor attaches the current token
    }

    try {
      await sharedRefresh();
    } catch (refreshErr) {
      // Session over: surface the original 401. Otherwise (network) surface
      // the network error so callers/offline queue can tell it apart.
      return Promise.reject(refreshErr instanceof SessionEndedError ? error : refreshErr);
    }
    return apiClient(original);
  },
);

// ─── Multipart helper (for photo uploads) ─────────────────────────────────────

export async function uploadFile(
  url: string,
  fileUri: string,
  fieldName: string,
  mimeType = 'image/jpeg',
): Promise<unknown> {
  const formData = new FormData();
  formData.append(fieldName, {
    uri:  fileUri,
    name: fileUri.split('/').pop() || 'upload.jpg',
    type: mimeType,
  } as unknown as Blob);

  // Authorization is attached (and refreshed on 401) by the interceptors.
  // Camera photos are several MB; site connections are slow, so allow longer
  // than the 15 s JSON default.
  const res = await apiClient.post(url, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120_000,
  });
  return res.data;
}
