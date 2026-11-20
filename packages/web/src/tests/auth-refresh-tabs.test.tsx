/**
 * Browser tabs take turns refreshing the session.
 *
 * The refresh token is an httpOnly cookie shared by every tab of the browser,
 * and the API rotates it on each refresh: the presented token is revoked and a
 * new one is set. Presenting an already-rotated token again ends the user's
 * sessions. Each tab keeps its own access token, so two tabs whose tokens
 * expire together both refresh; if the second tab's request leaves before the
 * first response has set the new cookie, it carries the old one and the user
 * is signed out. Every refresh therefore runs under one cross-tab lock (the
 * Web Locks API), held until the response and its cookie have been processed.
 *
 * A tab here is an isolated module instance (its own api.ts state and auth
 * store) sharing what tabs of one browser share: navigator.locks, the cookie
 * jar, localStorage and the server.
 */
import { render, waitFor } from '@testing-library/react';
import { AuthBootstrap } from '@/components/AuthBootstrap';
import { useAuthStore } from '@/store/auth.store';
import type { AuthUser } from '@/lib/types';

type ApiModule = typeof import('@/lib/api');
type StoreModule = typeof import('@/store/auth.store');

const USER: AuthUser = {
  id: 'user-1',
  email: 'pm@test.com',
  firstName: 'Pat',
  lastName: 'Manager',
  role: 'project_manager',
  companyId: 'company-1',
  currency: 'KES',
  canViewFinance: true,
  defaultProjectId: null,
  defaultSiteId: null,
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function reply(status: number, body: unknown) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

// ─── Fake browser + server ────────────────────────────────────────────────────

/**
 * The API's refresh rules and the browser's cookie jar. The cookie is read
 * when a request is sent and replaced when its response arrives (before fetch
 * resolves), as a browser does with Set-Cookie.
 */
class FakeServer {
  cookieJar: string | null = 'rt-0';
  latencyMs = 5;
  /** The next refresh fails without reaching the token logic. */
  failNextRefresh: null | 'network' | 503 = null;
  reuse = 0;
  events: string[] = [];
  /** Bearer tokens carried by non-refresh requests, in order. */
  resourceAuth: Array<string | null> = [];
  private valid = new Set<string>(['rt-0']);
  private revoked = new Set<string>();
  private live = new Set<string>();
  private issued = 0;

  async fetch(url: string, init: RequestInit = {}) {
    if (url === '/api/v1/auth/refresh') return this.refresh();
    const auth = (init.headers as Record<string, string> | undefined)?.Authorization ?? null;
    const token = auth ? auth.replace(/^Bearer /, '') : null;
    this.resourceAuth.push(token);
    await sleep(this.latencyMs);
    if (token && this.live.has(token)) return reply(200, { user: USER });
    return reply(401, { error: 'Unauthorized', code: 'UNAUTHORIZED' });
  }

  private async refresh() {
    const carried = this.cookieJar;
    this.events.push(`send ${carried}`);
    await sleep(this.latencyMs);
    if (this.failNextRefresh === 'network') {
      this.failNextRefresh = null;
      this.events.push('network error');
      throw new TypeError('Failed to fetch');
    }
    if (this.failNextRefresh === 503) {
      this.failNextRefresh = null;
      this.events.push('503');
      return reply(503, { error: 'Unavailable' });
    }
    if (carried && this.valid.has(carried)) {
      this.valid.delete(carried);
      this.revoked.add(carried);
      this.issued += 1;
      const next = `rt-${this.issued}`;
      const accessToken = `access-${this.issued}`;
      this.valid.add(next);
      this.live.add(accessToken);
      this.cookieJar = next;
      this.events.push(`rotated ${carried} -> ${next}`);
      return reply(200, { user: USER, accessToken, refreshToken: next });
    }
    if (carried && this.revoked.has(carried)) {
      // The server's reuse rule: every refresh token of the user is revoked.
      this.reuse += 1;
      for (const t of this.valid) this.revoked.add(t);
      this.valid.clear();
      this.events.push(`reuse ${carried}`);
      return reply(401, { error: 'Invalid or expired refresh token', code: 'UNAUTHORIZED' });
    }
    this.events.push(`invalid ${carried}`);
    return reply(401, { error: 'Invalid or expired refresh token', code: 'UNAUTHORIZED' });
  }

  sends() {
    return this.events.filter((e) => e.startsWith('send '));
  }
}

type GrantedCallback = (lock: { name: string; mode: string }) => unknown;

/** Exclusive Web Locks, FIFO per name, with the AbortSignal option. */
class FakeLockManager {
  requests: string[] = [];
  maxHeld = 0;
  private held = new Set<string>();
  private queues = new Map<string, Array<() => void>>();

  heldCount() {
    return this.held.size;
  }

  request(name: string, a: { signal?: AbortSignal } | GrantedCallback, b?: GrantedCallback): Promise<unknown> {
    const callback = (typeof a === 'function' ? a : b) as GrantedCallback;
    const signal = typeof a === 'function' ? undefined : a.signal;
    this.requests.push(name);
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('The request was aborted.', 'AbortError'));
        return;
      }
      const start = () => {
        signal?.removeEventListener('abort', onAbort);
        this.held.add(name);
        this.maxHeld = Math.max(this.maxHeld, this.held.size);
        Promise.resolve()
          .then(() => callback({ name, mode: 'exclusive' }))
          .then(resolve, reject)
          .finally(() => {
            this.held.delete(name);
            this.next(name);
          });
      };
      const onAbort = () => {
        const queue = this.queues.get(name) ?? [];
        const i = queue.indexOf(start);
        if (i >= 0) {
          queue.splice(i, 1);
          reject(new DOMException('The request was aborted.', 'AbortError'));
        }
      };
      signal?.addEventListener('abort', onAbort);
      const queue = this.queues.get(name) ?? [];
      this.queues.set(name, queue);
      queue.push(start);
      this.next(name);
    });
  }

  private next(name: string) {
    if (this.held.has(name)) return;
    const start = this.queues.get(name)?.shift();
    if (start) start();
  }
}

function setLocks(value: unknown) {
  Object.defineProperty(window.navigator, 'locks', { value, configurable: true, writable: true });
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

interface Tab {
  api: ApiModule;
  store: StoreModule['useAuthStore'];
  unauthorized: jest.Mock;
}

/** A signed-in tab whose access token has expired. */
function openTab(expiredToken: string): Tab {
  let api!: ApiModule;
  let storeModule!: StoreModule;
  jest.isolateModules(() => {
    api = require('@/lib/api') as ApiModule;
    storeModule = require('@/store/auth.store') as StoreModule;
  });
  const store = storeModule.useAuthStore;
  const unauthorized = jest.fn(() => store.getState().expireSession());
  // Wired as AuthBootstrap wires a mounted tab.
  api.configureApiClient(
    () => store.getState().accessToken,
    unauthorized,
    (user, token) => store.getState().setAuth(user, token),
  );
  store.getState().setAuth(USER, expiredToken);
  return { api, store, unauthorized };
}

async function until(condition: () => boolean, ms = 2000) {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > ms) throw new Error('condition not met in time');
    await sleep(1);
  }
}

let server: FakeServer;
let locks: FakeLockManager;

beforeEach(() => {
  localStorage.clear();
  useAuthStore.setState({
    user: null, accessToken: null, isBootstrapping: true, isHydrated: false, sessionExpired: false,
  });
  server = new FakeServer();
  locks = new FakeLockManager();
  (global as unknown as { fetch: unknown }).fetch = jest.fn(
    (url: string, init?: RequestInit) => server.fetch(String(url), init),
  );
  setLocks(locks);
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  setLocks(undefined);
});

// ─── Two tabs, one cookie ─────────────────────────────────────────────────────

describe('two tabs whose access tokens expire together', () => {
  it('refresh one after the other, each with the newest cookie; both stay signed in', async () => {
    const a = openTab('expired-A');
    const b = openTab('expired-B');

    const [ra, rb] = await Promise.all([a.api.authApi.me(), b.api.authApi.me()]);

    // The second refresh left only after the first response set the new cookie.
    expect(server.events).toEqual([
      'send rt-0', 'rotated rt-0 -> rt-1',
      'send rt-1', 'rotated rt-1 -> rt-2',
    ]);
    expect(server.reuse).toBe(0);

    // Both pending requests were retried with a new token and succeeded.
    expect(ra.user.email).toBe(USER.email);
    expect(rb.user.email).toBe(USER.email);
    expect(server.resourceAuth.slice(2).sort()).toEqual(['access-1', 'access-2']);
    for (const tab of [a, b]) {
      expect(tab.unauthorized).not.toHaveBeenCalled();
      expect(tab.store.getState().sessionExpired).toBe(false);
    }
    expect([a.store.getState().accessToken, b.store.getState().accessToken].sort())
      .toEqual(['access-1', 'access-2']);

    // One lock name for every refresh, never held twice at once, free afterwards.
    expect(locks.requests).toHaveLength(2);
    expect(new Set(locks.requests).size).toBe(1);
    expect(locks.maxHeld).toBe(1);
    expect(locks.heldCount()).toBe(0);
  });

  it('each tab still refreshes once for several requests that fail together', async () => {
    const a = openTab('expired-A');
    const b = openTab('expired-B');

    await Promise.all([
      a.api.authApi.me(), a.api.notificationApi.count(),
      b.api.authApi.me(), b.api.projectApi.list(),
    ]);

    expect(server.sends()).toEqual(['send rt-0', 'send rt-1']);
    expect(server.reuse).toBe(0);
    expect(a.unauthorized).not.toHaveBeenCalled();
    expect(b.unauthorized).not.toHaveBeenCalled();
  });

  it('without the Web Locks API behaviour is as before: both tabs send the same cookie and it is seen as reused', async () => {
    setLocks(undefined);
    const a = openTab('expired-A');
    const b = openTab('expired-B');

    const results = await Promise.allSettled([a.api.authApi.me(), b.api.authApi.me()]);

    expect(server.events).toEqual(['send rt-0', 'send rt-0', 'rotated rt-0 -> rt-1', 'reuse rt-0']);
    expect(server.reuse).toBe(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect([a, b].filter((t) => t.store.getState().sessionExpired)).toHaveLength(1);
  });
});

// ─── Failures inside the lock ─────────────────────────────────────────────────

describe('a refresh that fails inside the lock', () => {
  it.each([['a network error', 'network' as const], ['a 503 response', 503 as const]])(
    'releases the lock after %s, so the other tab refreshes instead of waiting',
    async (_label, failure) => {
      const a = openTab('expired-A');
      const b = openTab('expired-B');
      server.failNextRefresh = failure;

      const [ra, rb] = await Promise.allSettled([a.api.authApi.me(), b.api.authApi.me()]);

      expect(server.events).toEqual([
        'send rt-0', failure === 'network' ? 'network error' : '503',
        'send rt-0', 'rotated rt-0 -> rt-1',
      ]);
      expect(ra.status).toBe('rejected');
      expect(a.unauthorized).toHaveBeenCalledTimes(1);
      expect(rb.status).toBe('fulfilled');
      expect(b.store.getState().accessToken).toBe('access-1');
      expect(locks.heldCount()).toBe(0);
    },
  );

  it('a tab never waits forever behind a tab that stalls while holding the lock', async () => {
    jest.useFakeTimers();
    const a = openTab('expired-A');
    const b = openTab('expired-B');

    // Learn the lock name from one ordinary refresh, then let "another tab"
    // take the lock and never let go.
    const first = a.api.authApi.me();
    await jest.advanceTimersByTimeAsync(50);
    await first;
    expect(locks.requests).toHaveLength(1);
    void locks.request(locks.requests[0], () => new Promise(() => {}));

    const pending = b.api.authApi.me();
    let settled = false;
    void pending.then(() => { settled = true; }, () => { settled = true; });

    // B waits its turn while the lock is held...
    await jest.advanceTimersByTimeAsync(20_000);
    expect(server.sends()).toEqual(['send rt-0']);
    expect(settled).toBe(false);

    // ...but gives up waiting eventually and refreshes as it would without the lock.
    await jest.advanceTimersByTimeAsync(15_000);
    await expect(pending).resolves.toEqual({ user: USER });
    expect(server.sends()).toEqual(['send rt-0', 'send rt-1']);
    expect(b.unauthorized).not.toHaveBeenCalled();
  });
});

// ─── Startup refresh (AuthBootstrap case 3) ───────────────────────────────────

describe('a page opened while another tab is refreshing (AuthBootstrap)', () => {
  it('waits for that tab, then restores the session with the cookie it received', async () => {
    const a = openTab('expired-A');
    const pending = a.api.authApi.me();
    await until(() => server.events.includes('send rt-0'));

    render(<AuthBootstrap />);

    await waitFor(() => expect(useAuthStore.getState().accessToken).toBe('access-2'));
    await pending;
    expect(server.events).toEqual([
      'send rt-0', 'rotated rt-0 -> rt-1',
      'send rt-1', 'rotated rt-1 -> rt-2',
    ]);
    expect(server.reuse).toBe(0);
    expect(useAuthStore.getState().sessionExpired).toBe(false);
    expect(a.store.getState().accessToken).toBe('access-1');
    // Same lock as mid-session refreshes; the log lines are unchanged.
    expect(locks.requests).toHaveLength(2);
    expect(new Set(locks.requests).size).toBe(1);
    expect(console.log).toHaveBeenCalledWith('[auth] token restored');
    expect(console.log).toHaveBeenCalledWith('[auth] hydrated');
  });

  it('a failed startup refresh takes the lock, still clears auth without the "expired" state, and frees the lock', async () => {
    server.cookieJar = null;

    render(<AuthBootstrap />);

    await waitFor(() => expect(useAuthStore.getState().isHydrated).toBe(true));
    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.accessToken).toBeNull();
    expect(state.sessionExpired).toBe(false);
    expect(server.events).toEqual(['send null', 'invalid null']);
    expect(locks.requests).toHaveLength(1);
    expect(locks.heldCount()).toBe(0);
    expect(console.log).toHaveBeenCalledWith('[auth] hydrated');
    expect(console.log).not.toHaveBeenCalledWith('[auth] token restored');

    // The lock is free: another tab refreshes straight away.
    server.cookieJar = 'rt-0';
    const b = openTab('expired-B');
    await expect(b.api.authApi.me()).resolves.toEqual({ user: USER });
    expect(locks.requests).toHaveLength(2);
  });
});

// ─── authApi.refresh ──────────────────────────────────────────────────────────

describe('authApi.refresh', () => {
  it('waits for another tab\'s refresh and sends the newest cookie', async () => {
    const a = openTab('expired-A');
    const b = openTab('expired-B');
    const pending = b.api.authApi.me();
    await until(() => server.events.includes('send rt-0'));

    const result = await a.api.authApi.refresh();
    await pending;

    expect(result.accessToken).toBe('access-2');
    expect(server.events).toEqual([
      'send rt-0', 'rotated rt-0 -> rt-1',
      'send rt-1', 'rotated rt-1 -> rt-2',
    ]);
    expect(server.reuse).toBe(0);
    expect(new Set(locks.requests).size).toBe(1);
  });
});
