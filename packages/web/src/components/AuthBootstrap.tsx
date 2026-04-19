'use client';

import { useEffect } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { authApi, configureApiClient } from '@/lib/api';
import { getAccessToken } from '@/store/auth.store';

/**
 * Mounted once in the protected app layout.
 *
 * On first render:
 * 1. Wires the API client with our token getter and an unauthorised callback.
 * 2. If the store has no access token (e.g. after a page refresh),
 *    calls /auth/refresh using the httpOnly cookie.
 * 3. If refresh fails → marks session as expired (expireSession).
 *
 * Navigation on auth failure is intentionally NOT done here.
 * AuthGuard owns all auth-failure redirects to keep a single source of truth
 * and to prevent content from flashing before navigation completes.
 */
export function AuthBootstrap() {
  const { accessToken, setAuth, clearAuth, expireSession } = useAuthStore();

  useEffect(() => {
    // Wire API client — idempotent, safe to call on every render.
    // The unauthorized callback only clears state; AuthGuard handles the redirect.
    configureApiClient(getAccessToken, () => {
      expireSession();
    });

    // If we already have a token in memory (same-session navigation), done.
    if (accessToken) {
      useAuthStore.getState().setBootstrapping(false);
      return;
    }

    // Page was refreshed — Zustand state is gone. Try to restore from cookie.
    (async () => {
      try {
        const data = await authApi.refresh();
        setAuth(data.user, data.accessToken);
      } catch {
        // Cookie missing, expired, or server-side session invalidated.
        // clearAuth (not expireSession) — this is a fresh page load, not a
        // mid-session expiry, so we don't show the "session expired" banner.
        clearAuth();
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
