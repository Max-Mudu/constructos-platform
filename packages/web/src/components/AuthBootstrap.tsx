'use client';

import { useEffect, useRef } from 'react';
import { useAuthStore, getAccessToken, TOKEN_KEY, USER_KEY } from '@/store/auth.store';
import { configureApiClient } from '@/lib/api';
import type { AuthUser } from '@/lib/types';

const BASE = '/api/v1';

// ─── JWT helpers ──────────────────────────────────────────────────────────────

function parseJwtExp(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch { return null; }
}

/** Returns true if the token has more than 30 seconds left before expiry. */
function isTokenFresh(token: string): boolean {
  const exp = parseJwtExp(token);
  if (exp === null) return false;
  return Date.now() / 1000 < exp - 30;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Mounted once in the protected (app) layout.
 *
 * On every render: wires the API client with the token getter and auth
 * callbacks. Calling configureApiClient here (in the render body, not just
 * in useEffect) guarantees it is wired before any child component effects
 * fire their first data-fetch — important because React fires child effects
 * before parent effects in some scenarios.
 *
 * On first mount (useEffect):
 * 1. Already has in-memory token → same-session navigation, mark hydrated.
 * 2. localStorage has a fresh token → restore without a network round-trip.
 * 3. Neither → POST /auth/refresh using the httpOnly cookie.
 *    Uses a direct fetch (not authApi.refresh / request()) so a 401 from
 *    the refresh endpoint does NOT trigger the _onUnauthorized callback and
 *    does NOT mark the session as expired — a fresh page load with no valid
 *    session should land on plain /login, not /login?reason=expired.
 */
export function AuthBootstrap() {
  const { setAuth, clearAuth, expireSession } = useAuthStore();
  const started = useRef(false);

  // Wire API client synchronously on every render — idempotent.
  configureApiClient(
    getAccessToken,
    () => { expireSession(); },
    (user, token) => { setAuth(user, token); },
  );

  useEffect(() => {
    // Prevent double-bootstrap in React StrictMode / fast-refresh.
    if (started.current) return;
    started.current = true;

    // ── Case 1: same-session navigation ─────────────────────────────────────
    if (useAuthStore.getState().accessToken) {
      console.log('[auth] hydrated');
      useAuthStore.getState().setBootstrapping(false);
      return;
    }

    // ── Case 2: page refresh — restore from localStorage ────────────────────
    // Avoids a network round-trip when the access token is still fresh.
    let restoredFromStorage = false;
    try {
      const storedToken = localStorage.getItem(TOKEN_KEY);
      const storedUser  = localStorage.getItem(USER_KEY);
      if (storedToken && storedUser && isTokenFresh(storedToken)) {
        const user = JSON.parse(storedUser) as AuthUser;
        console.log('[auth] token restored');
        setAuth(user, storedToken);
        console.log('[auth] hydrated');
        restoredFromStorage = true;
      }
    } catch { /* localStorage unavailable (e.g. private browsing) */ }

    if (restoredFromStorage) return;

    // ── Case 3: no stored token — attempt httpOnly cookie refresh ────────────
    void (async () => {
      try {
        const res = await fetch(`${BASE}/auth/refresh`, {
          method:      'POST',
          credentials: 'include',
          headers:     { 'Content-Type': 'application/json' },
        });
        if (!res.ok) throw new Error('refresh_failed');
        const data = await res.json() as { accessToken: string; user: AuthUser };
        console.log('[auth] token restored');
        setAuth(data.user, data.accessToken);
        console.log('[auth] hydrated');
      } catch {
        // No valid cookie — treat as a fresh unauthenticated visit, not an
        // expiry event. clearAuth() (not expireSession()) so the user sees
        // a plain /login without the "session expired" banner.
        clearAuth();
        console.log('[auth] hydrated');
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
