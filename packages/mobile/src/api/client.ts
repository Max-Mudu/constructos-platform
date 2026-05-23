import axios, { AxiosInstance, AxiosRequestConfig, InternalAxiosRequestConfig } from 'axios';
import { getAccessToken, getRefreshToken, saveTokens } from '../auth/secureStorage';
import { useAuthStore } from '../store/auth.store';
import { API_BASE_URL } from '../constants/api';

const BASE_URL = API_BASE_URL;

// ─── Axios instance ───────────────────────────────────────────────────────────

export const apiClient: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

// ─── Request interceptor — attach Bearer token ────────────────────────────────

apiClient.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const token = await getAccessToken();
  if (token) {
    config.headers['Authorization'] = `Bearer ${token}`;
  }
  return config;
});

// ─── Response interceptor — auto-refresh on 401 ───────────────────────────────

let isRefreshing = false;
let failedQueue: Array<{
  resolve: (token: string) => void;
  reject: (err: unknown) => void;
}> = [];

function processQueue(error: unknown, token: string | null) {
  failedQueue.forEach((p) => {
    if (error) p.reject(error);
    else       p.resolve(token!);
  });
  failedQueue = [];
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config as AxiosRequestConfig & { _retry?: boolean };

    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({
            resolve: (token) => {
              if (originalRequest.headers) {
                originalRequest.headers['Authorization'] = `Bearer ${token}`;
              }
              resolve(apiClient(originalRequest));
            },
            reject,
          });
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const refreshToken = await getRefreshToken();
        if (!refreshToken) throw new Error('No refresh token');

        const res = await axios.post(`${BASE_URL}/auth/refresh`, { refreshToken });
        const { accessToken: newAccess, refreshToken: newRefresh } = res.data as {
          accessToken: string;
          refreshToken: string;
        };

        await saveTokens(newAccess, newRefresh);

        processQueue(null, newAccess);
        if (originalRequest.headers) {
          originalRequest.headers['Authorization'] = `Bearer ${newAccess}`;
        }
        return apiClient(originalRequest);
      } catch (refreshErr) {
        processQueue(refreshErr, null);
        // clearAuth clears secure storage AND resets Zustand state so the
        // UI navigates to login rather than showing a stale logged-in screen.
        await useAuthStore.getState().clearAuth();
        return Promise.reject(refreshErr);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  },
);

// ─── Multipart helper (for photo uploads) ─────────────────────────────────────

export async function uploadFile(
  url: string,
  fileUri: string,
  fieldName: string,
  mimeType = 'image/jpeg',
): Promise<unknown> {
  const token = await getAccessToken();
  const formData = new FormData();
  formData.append(fieldName, {
    uri:  fileUri,
    name: fileUri.split('/').pop() ?? 'upload.jpg',
    type: mimeType,
  } as unknown as Blob);

  const res = await apiClient.post(url, formData, {
    headers: {
      'Content-Type':  'multipart/form-data',
      Authorization:   `Bearer ${token}`,
    },
  });
  return res.data;
}
