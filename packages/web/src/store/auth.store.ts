'use client';

import { create } from 'zustand';
import { AuthUser } from '@/lib/types';

// ─── localStorage keys ────────────────────────────────────────────────────────

export const TOKEN_KEY = 'constructos_token';
export const USER_KEY  = 'constructos_user';

function persistToStorage(token: string | null, user: AuthUser | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (token && user) {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    }
  } catch { /* private browsing / quota */ }
}

// ─── State ────────────────────────────────────────────────────────────────────

interface AuthState {
  user:             AuthUser | null;
  accessToken:      string | null;
  /** True while the initial bootstrap refresh is in flight. */
  isBootstrapping:  boolean;
  /** True once bootstrap has completed (success or failure). Gate for AuthGuard. */
  isHydrated:       boolean;
  /**
   * Set when a mid-session API call receives 401 and the silent token refresh
   * also fails — i.e. the session has definitively expired.
   * Cleared when auth is successfully set or explicitly cleared.
   */
  sessionExpired:   boolean;

  setAuth:          (user: AuthUser, accessToken: string) => void;
  clearAuth:        () => void;
  expireSession:    () => void;
  setBootstrapping: (v: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user:            null,
  accessToken:     null,
  isBootstrapping: true,
  isHydrated:      false,
  sessionExpired:  false,

  setAuth: (user, accessToken) => {
    persistToStorage(accessToken, user);
    set({ user, accessToken, isBootstrapping: false, isHydrated: true, sessionExpired: false });
  },

  clearAuth: () => {
    persistToStorage(null, null);
    set({ user: null, accessToken: null, isBootstrapping: false, isHydrated: true, sessionExpired: false });
  },

  expireSession: () => {
    persistToStorage(null, null);
    set({ user: null, accessToken: null, isBootstrapping: false, isHydrated: true, sessionExpired: true });
  },

  setBootstrapping: (v) =>
    set(v ? { isBootstrapping: true } : { isBootstrapping: false, isHydrated: true }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Read current token without creating a React subscription. */
export function getAccessToken(): string | null {
  return useAuthStore.getState().accessToken;
}
