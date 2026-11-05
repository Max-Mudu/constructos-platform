/**
 * Contract checks for the thin daily-report client: paths, methods, bodies,
 * error bodies kept, and the 401 → refresh → retry path.
 */
const mockMe = jest.fn();
jest.mock('@/lib/api', () => {
  class ApiError extends Error {
    constructor(public status: number, public code: string, message: string) { super(message); }
  }
  return { ApiError, authApi: { me: (...a: unknown[]) => mockMe(...a) } };
});

let token: string | null = 'T1';
const mockExpire = jest.fn();
jest.mock('@/store/auth.store', () => ({
  getAccessToken: () => token,
  useAuthStore: { getState: () => ({ expireSession: mockExpire }) },
}));

import { DailyReportApiError, dailyReportApi, missingFromError, reportIdFromError } from '@/lib/daily-report-api';

type Call = { url: string; init: RequestInit };
let calls: Call[] = [];
let responses: Response[] = [];

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return mk(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

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

// jsdom has no fetch/Response; a minimal Response is enough for the client.
class MiniResponse {
  status: number;
  ok: boolean;
  headers: { get: (k: string) => string | null };
  private body: string | null;
  constructor(body: string | null, init: { status: number; headers?: Record<string, string> }) {
    this.body = body;
    this.status = init.status;
    this.ok = init.status >= 200 && init.status < 300;
    const h = new Map(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    this.headers = { get: (k: string) => h.get(k.toLowerCase()) ?? null };
  }
  async json() { return JSON.parse(this.body ?? ''); }
  async blob() { return new Blob([this.body ?? '']); }
}
const mk = (body: string | null, init: { status: number; headers?: Record<string, string> }) =>
  new MiniResponse(body, init) as unknown as Response;

const BASE = '/api/v1/projects/p1/sites/s1/daily-reports';

describe('dailyReportApi', () => {
  it('list builds the query and sends the bearer token', async () => {
    responses.push(json(200, { reports: [], nextCursor: null }));
    await dailyReportApi.list('p1', 's1', { date: '2026-11-05', cursor: 'c1', limit: 999 });
    expect(calls[0].url).toBe(`${BASE}?date=2026-11-05&cursor=c1&limit=50`);
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer T1');
    expect(calls[0].init.method).toBe('GET');
  });

  it('createOrOpen POSTs reportDate; 409 REPORT_FINAL exposes reportId', async () => {
    responses.push(json(409, { error: 'final', code: 'REPORT_FINAL', reportId: 'r9' }));
    const e = await dailyReportApi.createOrOpen('p1', 's1', '2026-11-05').catch((x) => x);
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ reportDate: '2026-11-05' });
    expect(e).toBeInstanceOf(DailyReportApiError);
    expect(e.code).toBe('REPORT_FINAL');
    expect(reportIdFromError(e)).toBe('r9');
  });

  it('update PATCHes rawInput with expectedUpdatedAt', async () => {
    responses.push(json(200, { report: { id: 'r1' } }));
    await dailyReportApi.update('p1', 's1', 'r1', { rawInput: 'notes', expectedUpdatedAt: '2026-11-05T10:00:00.000Z' });
    expect(calls[0].url).toBe(`${BASE}/r1`);
    expect(calls[0].init.method).toBe('PATCH');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ rawInput: 'notes', expectedUpdatedAt: '2026-11-05T10:00:00.000Z' });
  });

  it('finalise keeps the REVIEW_INCOMPLETE missing list', async () => {
    responses.push(json(422, { error: 'x', code: 'REVIEW_INCOMPLETE', missing: ['weather', 'remarks'] }));
    const e = await dailyReportApi.finalise('p1', 's1', 'r1', 'U').catch((x) => x);
    expect(calls[0].url).toBe(`${BASE}/r1/finalise`);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ expectedUpdatedAt: 'U' });
    expect(e.status).toBe(422);
    expect(missingFromError(e)).toEqual(['weather', 'remarks']);
  });

  it('extract and reopen hit their routes with the contract bodies', async () => {
    responses.push(json(200, { report: {} }), json(200, { report: {} }));
    await dailyReportApi.extract('p1', 's1', 'r1');
    await dailyReportApi.reopen('p1', 's1', 'r1', 'Wrong count', 'U');
    expect(calls[0].url).toBe(`${BASE}/r1/extract`);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({});
    expect(calls[1].url).toBe(`${BASE}/r1/reopen`);
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ reason: 'Wrong count', expectedUpdatedAt: 'U' });
  });

  it('photo caption PATCH and DELETE (204)', async () => {
    responses.push(json(200, { photo: { id: 'ph1' } }), mk(null, { status: 204 }));
    await dailyReportApi.updatePhoto('p1', 's1', 'r1', 'ph1', { caption: 'Slab' });
    await expect(dailyReportApi.deletePhoto('p1', 's1', 'r1', 'ph1')).resolves.toBeUndefined();
    expect(calls[0].url).toBe(`${BASE}/r1/photos/ph1`);
    expect(calls[1].init.method).toBe('DELETE');
  });

  it('pdf requests a revision and returns the blob + Content-Disposition', async () => {
    responses.push(mk('%PDF', { status: 200, headers: { 'Content-Disposition': 'attachment; filename="DR-0007-rev1.pdf"' } }));
    const out = await dailyReportApi.pdf('p1', 's1', 'r1', 1);
    expect(calls[0].url).toBe(`${BASE}/r1/pdf?revision=1`);
    expect(out.contentDisposition).toBe('attachment; filename="DR-0007-rev1.pdf"');
    expect(out.blob).toBeTruthy();
  });

  it('on 401 refreshes through lib/api once and retries with the new token', async () => {
    responses.push(json(401, { error: 'x', code: 'UNAUTHORIZED' }), json(200, { report: { id: 'r1' } }));
    mockMe.mockImplementation(async () => { token = 'T2'; return { user: {} }; });
    await dailyReportApi.get('p1', 's1', 'r1');
    expect(mockMe).toHaveBeenCalledTimes(1);
    expect((calls[1].init.headers as Record<string, string>).Authorization).toBe('Bearer T2');
  });

  it('ends the session when the refresh fails', async () => {
    responses.push(json(401, { error: 'x', code: 'UNAUTHORIZED' }));
    mockMe.mockRejectedValue(new Error('401'));
    const e = await dailyReportApi.get('p1', 's1', 'r1').catch((x) => x);
    expect(e.code).toBe('UNAUTHORIZED');
    expect(mockExpire).toHaveBeenCalled();
  });

  it('turns a network failure into NETWORK', async () => {
    (global as unknown as { fetch: unknown }).fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const e = await dailyReportApi.get('p1', 's1', 'r1').catch((x) => x);
    expect(e.code).toBe('NETWORK');
  });

  it('encodes ids in paths', async () => {
    responses.push(json(200, { report: {} }));
    await dailyReportApi.get('p 1', 's/1', 'r?1');
    expect(calls[0].url).toBe('/api/v1/projects/p%201/sites/s%2F1/daily-reports/r%3F1');
  });
});
