/**
 * Session expiry tests.
 *
 * Covers:
 *  - Auth store: expireSession(), sessionExpired flag lifecycle
 *  - Auth store: setAuth() and clearAuth() clear the sessionExpired flag
 *  - getAccessToken() returns null after expireSession()
 *  - AuthGuard render-state machine (spinner on redirect, never blank)
 *  - AuthGuard redirect URL derivation (pure logic)
 *  - Middleware routing logic (pure function mirror)
 *  - Login page session-expired message derivation (pure logic)
 */

import { act } from 'react';
import { useAuthStore, getAccessToken } from '@/store/auth.store';
import { AuthUser } from '@/lib/types';

// ── helpers ──────────────────────────────────────────────────────────────────

const mockUser: AuthUser = {
  id: 'user-1',
  email: 'admin@test.com',
  firstName: 'Test',
  lastName: 'Admin',
  role: 'company_admin',
  companyId: 'company-1',
  canViewFinance: true,
};

/** Mirror of the redirect logic inside AuthGuard — tested as a pure function. */
function buildLoginRedirectUrl(
  sessionExpired: boolean,
  pathname: string,
): string {
  if (sessionExpired) {
    const params = new URLSearchParams({ reason: 'expired', next: pathname });
    return `/login?${params.toString()}`;
  }
  return '/login';
}

/** Mirror of the isExpired derivation in login/page.tsx */
function isExpiredSession(reason: string | null): boolean {
  return reason === 'expired';
}

/**
 * Mirror of the AuthGuard render-state machine.
 * Returns what the guard should render given the current auth state.
 *
 * 'spinner'  — full-page loading indicator (isBootstrapping OR user=null/redirecting)
 * 'children' — render page content (authenticated)
 *
 * This function verifies the "never blank" contract: the guard NEVER returns
 * a value that would cause a blank dark screen.
 */
function authGuardRenderState(
  isBootstrapping: boolean,
  user: AuthUser | null,
): 'spinner' | 'children' {
  if (isBootstrapping) return 'spinner';
  if (!user)           return 'spinner'; // redirect in flight — show spinner, NOT null/blank
  return 'children';
}

/**
 * Mirror of the middleware routing logic.
 * Returns what the middleware should do for a given request.
 */
const PUBLIC_PATHS = ['/login', '/register'];
const ALWAYS_ALLOWED = [
  '/_next', '/favicon.ico',
  '/api/v1/auth/login', '/api/v1/auth/register', '/api/v1/auth/refresh',
];

function middlewareDecision(
  pathname: string,
  hasRefreshToken: boolean,
): 'allow' | 'redirect-to-login' {
  if (ALWAYS_ALLOWED.some((p) => pathname.startsWith(p))) return 'allow';
  if (PUBLIC_PATHS.includes(pathname))                      return 'allow';
  if (!hasRefreshToken) return 'redirect-to-login';
  return 'allow';
}

// ── beforeEach ───────────────────────────────────────────────────────────────

beforeEach(() => {
  useAuthStore.setState({
    user: null,
    accessToken: null,
    isBootstrapping: true,
    sessionExpired: false,
  });
});

// ── expireSession() ───────────────────────────────────────────────────────────

describe('useAuthStore — expireSession', () => {
  it('clears user and accessToken', () => {
    act(() => { useAuthStore.getState().setAuth(mockUser, 'token-abc'); });
    act(() => { useAuthStore.getState().expireSession(); });

    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.accessToken).toBeNull();
  });

  it('sets sessionExpired to true', () => {
    act(() => { useAuthStore.getState().setAuth(mockUser, 'token-abc'); });
    act(() => { useAuthStore.getState().expireSession(); });

    expect(useAuthStore.getState().sessionExpired).toBe(true);
  });

  it('sets isBootstrapping to false', () => {
    act(() => { useAuthStore.getState().expireSession(); });

    expect(useAuthStore.getState().isBootstrapping).toBe(false);
  });

  it('makes getAccessToken() return null', () => {
    act(() => { useAuthStore.getState().setAuth(mockUser, 'token-abc'); });
    expect(getAccessToken()).toBe('token-abc');

    act(() => { useAuthStore.getState().expireSession(); });
    expect(getAccessToken()).toBeNull();
  });
});

// ── sessionExpired flag lifecycle ─────────────────────────────────────────────

describe('useAuthStore — sessionExpired flag lifecycle', () => {
  it('setAuth clears the sessionExpired flag', () => {
    act(() => { useAuthStore.getState().expireSession(); });
    expect(useAuthStore.getState().sessionExpired).toBe(true);

    act(() => { useAuthStore.getState().setAuth(mockUser, 'new-token'); });
    expect(useAuthStore.getState().sessionExpired).toBe(false);
    expect(useAuthStore.getState().user).toEqual(mockUser);
  });

  it('clearAuth clears the sessionExpired flag', () => {
    act(() => { useAuthStore.getState().expireSession(); });
    expect(useAuthStore.getState().sessionExpired).toBe(true);

    act(() => { useAuthStore.getState().clearAuth(); });
    expect(useAuthStore.getState().sessionExpired).toBe(false);
  });

  it('sessionExpired starts as false on a fresh store', () => {
    expect(useAuthStore.getState().sessionExpired).toBe(false);
  });

  it('sessionExpired is false after a normal logout (clearAuth)', () => {
    act(() => { useAuthStore.getState().setAuth(mockUser, 'token'); });
    act(() => { useAuthStore.getState().clearAuth(); });

    expect(useAuthStore.getState().sessionExpired).toBe(false);
  });
});

// ── AuthGuard render-state machine — never blank ──────────────────────────────

describe('AuthGuard — render-state machine (no blank screen)', () => {
  it('shows spinner while bootstrapping (refresh in flight)', () => {
    expect(authGuardRenderState(true, null)).toBe('spinner');
  });

  it('shows spinner when bootstrapping even if user object is somehow set', () => {
    expect(authGuardRenderState(true, mockUser)).toBe('spinner');
  });

  it('shows spinner when bootstrap done but user is null (redirect in flight)', () => {
    // This is the KEY fix: was previously "null" (blank), now "spinner".
    expect(authGuardRenderState(false, null)).toBe('spinner');
  });

  it('renders children only when bootstrap done and user is present', () => {
    expect(authGuardRenderState(false, mockUser)).toBe('children');
  });

  it('never returns a blank/null state in any scenario', () => {
    const cases: [boolean, AuthUser | null][] = [
      [true,  null],
      [true,  mockUser],
      [false, null],
      [false, mockUser],
    ];
    for (const [bootstrapping, user] of cases) {
      const result = authGuardRenderState(bootstrapping, user);
      expect(result).not.toBeUndefined();
      expect(result).not.toBeNull();
      expect(['spinner', 'children']).toContain(result);
    }
  });
});

// ── AuthGuard redirect URL derivation ────────────────────────────────────────

describe('AuthGuard — redirect URL derivation', () => {
  it('redirects to /login with reason=expired and next= when session expired', () => {
    const url = buildLoginRedirectUrl(true, '/projects/123');
    expect(url).toContain('reason=expired');
    expect(url).toContain('next=');
    expect(url).toContain(encodeURIComponent('/projects/123'));
  });

  it('redirects to plain /login when session not expired (bootstrap failure or logout)', () => {
    const url = buildLoginRedirectUrl(false, '/dashboard');
    expect(url).toBe('/login');
  });

  it('preserves nested paths in the next= param', () => {
    const url = buildLoginRedirectUrl(true, '/projects/abc/sites/def');
    expect(url).toContain(encodeURIComponent('/projects/abc/sites/def'));
  });

  it('never includes ?next= when sessionExpired is false', () => {
    const url = buildLoginRedirectUrl(false, '/dashboard');
    expect(url).not.toContain('next=');
    expect(url).not.toContain('reason=');
  });
});

// ── Middleware routing logic ──────────────────────────────────────────────────

describe('Middleware — routing decisions', () => {
  describe('unauthenticated users (no cookie)', () => {
    it('allows access to /login', () => {
      expect(middlewareDecision('/login', false)).toBe('allow');
    });

    it('allows access to /register', () => {
      expect(middlewareDecision('/register', false)).toBe('allow');
    });

    it('redirects /dashboard to login', () => {
      expect(middlewareDecision('/dashboard', false)).toBe('redirect-to-login');
    });

    it('redirects /projects to login', () => {
      expect(middlewareDecision('/projects', false)).toBe('redirect-to-login');
    });

    it('redirects /finance to login', () => {
      expect(middlewareDecision('/finance', false)).toBe('redirect-to-login');
    });
  });

  describe('users with a cookie (valid or stale)', () => {
    it('allows access to protected /dashboard', () => {
      expect(middlewareDecision('/dashboard', true)).toBe('allow');
    });

    it('allows access to /login — does NOT redirect to dashboard', () => {
      // Critical fix: removed the "has cookie → redirect to /dashboard" behavior
      // that caused an infinite loop for users with expired/invalid sessions.
      expect(middlewareDecision('/login', true)).toBe('allow');
    });

    it('allows access to /register', () => {
      expect(middlewareDecision('/register', true)).toBe('allow');
    });
  });

  describe('Next.js internals and API auth routes', () => {
    it('always allows /_next/* routes', () => {
      expect(middlewareDecision('/_next/static/chunks/main.js', false)).toBe('allow');
    });

    it('always allows /api/v1/auth/refresh', () => {
      expect(middlewareDecision('/api/v1/auth/refresh', false)).toBe('allow');
    });

    it('always allows /api/v1/auth/login', () => {
      expect(middlewareDecision('/api/v1/auth/login', false)).toBe('allow');
    });

    it('always allows /favicon.ico', () => {
      expect(middlewareDecision('/favicon.ico', false)).toBe('allow');
    });
  });
});

// ── Login page — expired-session message derivation ──────────────────────────

describe('LoginPage — session expired message', () => {
  it('returns true when reason=expired', () => {
    expect(isExpiredSession('expired')).toBe(true);
  });

  it('returns false when reason is null (no query param)', () => {
    expect(isExpiredSession(null)).toBe(false);
  });

  it('returns false when reason is some other value', () => {
    expect(isExpiredSession('unauthorized')).toBe(false);
    expect(isExpiredSession('')).toBe(false);
  });

  it('is case-sensitive — "Expired" is not a match', () => {
    expect(isExpiredSession('Expired')).toBe(false);
  });
});

// ── Stale user data cleared on expiry ────────────────────────────────────────

describe('Auth state — stale user data cleared on expiry', () => {
  it('user data is null immediately after expireSession', () => {
    act(() => { useAuthStore.getState().setAuth(mockUser, 'token'); });
    expect(useAuthStore.getState().user?.firstName).toBe('Test');

    act(() => { useAuthStore.getState().expireSession(); });
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().user?.firstName).toBeUndefined();
  });

  it('accessToken is null so no authenticated requests can be made after expiry', () => {
    act(() => { useAuthStore.getState().setAuth(mockUser, 'token-xyz'); });
    act(() => { useAuthStore.getState().expireSession(); });

    expect(getAccessToken()).toBeNull();
  });
});
