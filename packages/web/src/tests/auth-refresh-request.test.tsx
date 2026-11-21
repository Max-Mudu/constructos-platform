/**
 * The session refresh request must be one the API accepts. The API (Fastify)
 * refuses a request that declares a JSON body but sends none, with 400 and
 * before the refresh handler runs. The refresh token travels in the httpOnly
 * cookie, so these requests send no body and must not declare one.
 */
import { render, waitFor } from '@testing-library/react';
import { AuthBootstrap } from '@/components/AuthBootstrap';
import { authApi, configureApiClient } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import type { AuthUser } from '@/lib/types';

const user = {
  id: 'u1', email: 'pm@test.com', firstName: 'P', lastName: 'M', role: 'project_manager',
  companyId: 'c1', currency: 'KES', canViewFinance: false, defaultProjectId: null, defaultSiteId: null,
} as unknown as AuthUser;

interface Call { url: string; init: RequestInit }
let calls: Call[] = [];
const realFetch = global.fetch;

function json(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

/** True when the request declares a JSON body without sending one (the API answers 400). */
function declaresEmptyJsonBody(init: RequestInit): boolean {
  const headers = (init.headers ?? {}) as Record<string, string>;
  const type = Object.entries(headers).find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? '';
  return type.includes('application/json') && init.body == null;
}

beforeEach(() => {
  calls = [];
  localStorage.clear();
  useAuthStore.getState().clearAuth();
});

afterEach(() => {
  global.fetch = realFetch;
});

describe('session refresh requests', () => {
  it('the refresh after a 401 does not declare an empty JSON body', async () => {
    let meCalls = 0;
    global.fetch = jest.fn(async (url: RequestInfo | URL, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith('/auth/refresh')) return json(200, { accessToken: 'new-token', user });
      meCalls += 1;
      return meCalls === 1 ? json(401, { error: 'expired' }) : json(200, { user });
    }) as typeof fetch;
    configureApiClient(() => 'old-token', jest.fn(), jest.fn());

    await authApi.me();

    const refresh = calls.filter((c) => c.url.endsWith('/auth/refresh'));
    expect(refresh).toHaveLength(1);
    expect(refresh[0]!.init.method).toBe('POST');
    expect(declaresEmptyJsonBody(refresh[0]!.init)).toBe(false);
  });

  it('authApi.refresh does not declare an empty JSON body', async () => {
    global.fetch = jest.fn(async (url: RequestInfo | URL, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      return json(200, { accessToken: 't', user });
    }) as typeof fetch;
    configureApiClient(() => null, jest.fn(), jest.fn());

    await authApi.refresh();

    expect(calls).toHaveLength(1);
    expect(declaresEmptyJsonBody(calls[0]!.init)).toBe(false);
  });

  it('the startup refresh (no stored token) does not declare an empty JSON body', async () => {
    global.fetch = jest.fn(async (url: RequestInfo | URL, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      return json(200, { accessToken: 't', user });
    }) as typeof fetch;

    render(<AuthBootstrap />);

    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/auth/refresh'))).toBe(true));
    const refresh = calls.find((c) => c.url.endsWith('/auth/refresh'))!;
    expect(declaresEmptyJsonBody(refresh.init)).toBe(false);
    await waitFor(() => expect(useAuthStore.getState().accessToken).toBe('t'));
  });
});
