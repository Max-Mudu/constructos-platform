/**
 * Contract checks for the team client: paths, query building, bodies,
 * no-store caching, error bodies kept, and 401 → refresh → retry.
 */
const mockMe = jest.fn();
jest.mock('@/lib/api', () => {
  class ApiError extends Error {
    constructor(public status: number, public code: string, message: string, public details?: Record<string, string[]>) {
      super(message);
    }
  }
  return { ApiError, authApi: { me: (...a: unknown[]) => mockMe(...a) } };
});

let token: string | null = 'T1';
const mockExpire = jest.fn();
jest.mock('@/store/auth.store', () => ({
  getAccessToken: () => token,
  useAuthStore: { getState: () => ({ expireSession: mockExpire }) },
}));

import { ApiError } from '@/lib/api';
import { buildListQueryString, teamApi } from '@/lib/team-api';

type Call = { url: string; init: RequestInit };
let calls: Call[] = [];
let responses: Response[] = [];

class MiniResponse {
  ok: boolean;
  constructor(private body: string | null, public status: number) { this.ok = status >= 200 && status < 300; }
  async json() { return JSON.parse(this.body ?? ''); }
}
const json = (status: number, body: unknown) => new MiniResponse(JSON.stringify(body), status) as unknown as Response;

beforeEach(() => {
  calls = [];
  responses = [];
  token = 'T1';
  mockMe.mockReset();
  mockExpire.mockReset();
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses.shift();
    if (!r) throw new Error('no response queued');
    return r;
  });
});

describe('buildListQueryString', () => {
  it('is empty with no filters', () => {
    expect(buildListQueryString()).toBe('');
  });

  it('encodes filters and clamps the limit to the API ceiling', () => {
    expect(buildListQueryString({ role: 'viewer', isActive: false, search: '  a&b ', limit: 999, offset: 10 }))
      .toBe('?role=viewer&isActive=false&search=a%26b&limit=200&offset=10');
  });

  it('caps search at 100 characters', () => {
    const qs = new URLSearchParams(buildListQueryString({ search: 'x'.repeat(150) }).slice(1));
    expect(qs.get('search')).toHaveLength(100);
  });
});

describe('teamApi', () => {
  it('list GETs the company users endpoint with the bearer token and no-store', async () => {
    responses.push(json(200, { users: [], total: 0, limit: 200, offset: 0 }));
    await teamApi.list({ isActive: true, limit: 200 });
    expect(calls[0].url).toBe('/api/v1/companies/me/users?isActive=true&limit=200');
    expect(calls[0].init.method).toBe('GET');
    expect(calls[0].init.cache).toBe('no-store');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer T1');
  });

  it('create POSTs the JSON payload', async () => {
    responses.push(json(201, { user: { id: 'u1', email: 'a@b.co' }, setupEmailSent: false, setupLink: 'L' }));
    const res = await teamApi.create({ email: 'a@b.co', firstName: 'A', lastName: 'B', role: 'finance_officer' });
    expect(calls[0].url).toBe('/api/v1/companies/me/users');
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ email: 'a@b.co', firstName: 'A', lastName: 'B', role: 'finance_officer' });
    expect(calls[0].init.cache).toBe('no-store');
    expect(res.setupLink).toBe('L');
  });

  it('keeps status, code, message and field details on errors', async () => {
    responses.push(json(422, { error: 'Validation failed', code: 'VALIDATION_ERROR', details: { email: ['Invalid email'] } }));
    const err = await teamApi.create({ email: 'x', firstName: 'A', lastName: 'B', role: 'viewer' }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 422, code: 'VALIDATION_ERROR', message: 'Validation failed', details: { email: ['Invalid email'] } });

    responses.push(json(409, { error: 'An account with this email already exists', code: 'CONFLICT' }));
    const dup = await teamApi.create({ email: 'a@b.co', firstName: 'A', lastName: 'B', role: 'viewer' }).catch((e) => e);
    expect(dup).toMatchObject({ status: 409, code: 'CONFLICT' });
  });

  it('refreshes once on 401 and retries with the new token', async () => {
    responses.push(json(401, { error: 'expired' }));
    responses.push(json(200, { users: [], total: 0, limit: 100, offset: 0 }));
    mockMe.mockImplementation(async () => { token = 'T2'; });
    await teamApi.list();
    expect(mockMe).toHaveBeenCalledTimes(1);
    expect((calls[1].init.headers as Record<string, string>).Authorization).toBe('Bearer T2');
  });

  it('ends the session when the refresh fails', async () => {
    responses.push(json(401, { error: 'expired' }));
    mockMe.mockRejectedValue(new Error('no session'));
    const err = await teamApi.list().catch((e) => e);
    expect(err).toMatchObject({ status: 401 });
    expect(mockExpire).toHaveBeenCalled();
  });
});
