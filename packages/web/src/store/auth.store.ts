'use client';

import { create } from 'zustand';
import { AuthUser } from '@/lib/types';

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  /** true while the initial refresh-on-mount is in flight */
  isBootstrapping: boolean;
  /**
   * Set to true when a mid-session API call receives 401 and the silent
   * token refresh also fails — i.e. the session has definitively expired.
   * Cleared whenever auth is successfully set or explicitly cleared (logout).
   */
  sessionExpired: boolean;

  setAuth: (user: AuthUser, accessToken: string) => void;
  clearAuth: () => void;
  /** Mark the session as expired without explicitly logging out. */
  expireSession: () => void;
  setBootstrapping: (v: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  isBootstrapping: true,
  sessionExpired: false,

  setAuth: (user, accessToken) =>
    set({ user, accessToken, isBootstrapping: false, sessionExpired: false }),

  clearAuth: () =>
    set({ user: null, accessToken: null, isBootstrapping: false, sessionExpired: false }),

  expireSession: () =>
    set({ user: null, accessToken: null, isBootstrapping: false, sessionExpired: true }),

  setBootstrapping: (v) => set({ isBootstrapping: v }),
}));

// Provide the current access token to the API client without creating a
// circular dependency between the store and the API module at module-load time.
export function getAccessToken(): string | null {
  return useAuthStore.getState().accessToken;
}
