/**
 * Multipart uploads go through the shared request path.
 *
 * Previously drawing revisions and instruction attachments used request()'s
 * 15 s abort (too short for a 20 MB file on a site connection), and delivery
 * photo/document uploads used a raw fetch with no 401 -> refresh -> retry and
 * no validation details. Every upload now uses UPLOAD_TIMEOUT_MS, refreshes
 * the session once on 401, maps errors to ApiError, and sends the FormData
 * as-is with no manual Content-Type (the browser adds the boundary).
 */
import {
  ApiError, configureApiClient, deliveryApi, drawingApi, instructionApi, projectApi,
  REQUEST_TIMEOUT_MS, UPLOAD_TIMEOUT_MS,
} from '@/lib/api';
import type { AuthUser } from '@/lib/types';

type FetchInit = RequestInit & { headers: Record<string, string>; signal: AbortSignal };

function res(status: number, body: unknown = {}) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

let token: string | null;
const onUnauthorized = jest.fn();
const onAuthRefreshed = jest.fn((_user: AuthUser, t: string) => { token = t; });
const fetchMock = jest.fn();

beforeEach(() => {
  token = 'old-token';
  onUnauthorized.mockClear();
  onAuthRefreshed.mockClear();
  fetchMock.mockReset();
  (global as unknown as { fetch: unknown }).fetch = fetchMock;
  configureApiClient(() => token, onUnauthorized, onAuthRefreshed);
});

afterEach(() => {
  jest.useRealTimers();
});

const call = (i: number) => fetchMock.mock.calls[i] as [string, FetchInit];

function file(name = 'plan.pdf') {
  return new File(['%PDF-1.4'], name, { type: 'application/pdf' });
}

const UPLOADS: Array<[string, () => Promise<unknown>, string]> = [
  ['drawingApi.uploadRevision', () => {
    const fd = new FormData();
    fd.append('revisionNumber', 'B');
    fd.append('file', file());
    return drawingApi.uploadRevision('p1', 'd1', fd);
  }, '/api/v1/projects/p1/drawings/d1/revisions'],
  ['instructionApi.uploadAttachment', () => {
    const fd = new FormData();
    fd.append('file', file());
    return instructionApi.uploadAttachment('p1', 'i1', fd);
  }, '/api/v1/projects/p1/instructions/i1/attachments'],
  ['deliveryApi.uploadPhoto', () => deliveryApi.uploadPhoto('p1', 's1', 'del1', file('photo.jpg')),
    '/api/v1/projects/p1/sites/s1/deliveries/del1/photos'],
  ['deliveryApi.uploadDocument', () => deliveryApi.uploadDocument('p1', 's1', 'del1', file()),
    '/api/v1/projects/p1/sites/s1/deliveries/del1/documents'],
];

describe('upload timeout', () => {
  it('uploads get a much longer timeout than ordinary requests', () => {
    expect(REQUEST_TIMEOUT_MS).toBe(15_000);
    expect(UPLOAD_TIMEOUT_MS).toBeGreaterThanOrEqual(120_000);
  });

  function hangUntilAborted() {
    fetchMock.mockImplementation((_url: string, init: FetchInit) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
      });
    }));
  }

  it.each(UPLOADS)('%s is still running after the ordinary timeout and aborts at UPLOAD_TIMEOUT_MS', async (_n, run) => {
    jest.useFakeTimers();
    hangUntilAborted();
    let settled: unknown = 'pending';
    const p = run().then(() => { settled = 'resolved'; }, (e) => { settled = e; });

    await jest.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 1_000);
    expect(settled).toBe('pending');

    await jest.advanceTimersByTimeAsync(UPLOAD_TIMEOUT_MS - REQUEST_TIMEOUT_MS);
    await p;
    expect(settled).toBeInstanceOf(ApiError);
    expect((settled as ApiError).status).toBe(408);
    expect((settled as ApiError).code).toBe('TIMEOUT');
  });

  it('an ordinary JSON request still aborts at REQUEST_TIMEOUT_MS (control)', async () => {
    jest.useFakeTimers();
    hangUntilAborted();
    let settled: unknown = 'pending';
    const p = projectApi.list().then(() => { settled = 'resolved'; }, (e) => { settled = e; });
    await jest.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 1);
    await p;
    expect(settled).toBeInstanceOf(ApiError);
    expect((settled as ApiError).code).toBe('TIMEOUT');
  });
});

describe('FormData passthrough', () => {
  it.each(UPLOADS)('%s POSTs the FormData itself with the bearer token and no Content-Type', async (_n, run, url) => {
    fetchMock.mockResolvedValueOnce(res(201, { ok: true }));
    await expect(run()).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = call(0);
    expect(calledUrl).toBe(url);
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('file')).toBeInstanceOf(File);
    expect(init.credentials).toBe('include');
    expect(init.headers.Authorization).toBe('Bearer old-token');
    const headerNames = Object.keys(init.headers).map((h) => h.toLowerCase());
    expect(headerNames).not.toContain('content-type');
  });

  it('passes the caller\'s FormData instance unchanged (fields before the file)', async () => {
    fetchMock.mockResolvedValueOnce(res(201, { revision: {} }));
    const fd = new FormData();
    fd.append('revisionNumber', 'C');
    fd.append('status', 'draft');
    fd.append('file', file());
    await drawingApi.uploadRevision('p1', 'd1', fd);
    const body = call(0)[1].body as FormData;
    expect(body).toBe(fd);
    expect(Array.from(body.keys())).toEqual(['revisionNumber', 'status', 'file']);
  });

  it('JSON requests still send Content-Type: application/json (control)', async () => {
    fetchMock.mockResolvedValueOnce(res(200, { project: {} }));
    await projectApi.update('p1', { name: 'X' });
    expect(call(0)[1].headers['Content-Type']).toBe('application/json');
  });
});

describe('401 -> refresh -> retry once', () => {
  const user = { id: 'u1' } as AuthUser;

  it.each(UPLOADS)('%s refreshes the session and retries once with the new token and the same body', async (_n, run, url) => {
    fetchMock
      .mockResolvedValueOnce(res(401, { error: 'expired' }))
      .mockResolvedValueOnce(res(200, { accessToken: 'new-token', user }))
      .mockResolvedValueOnce(res(201, { ok: true }));

    await expect(run()).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(call(1)[0]).toBe('/api/v1/auth/refresh');
    expect(onAuthRefreshed).toHaveBeenCalledWith(user, 'new-token');
    expect(call(2)[0]).toBe(url);
    expect(call(2)[1].headers.Authorization).toBe('Bearer new-token');
    expect(call(2)[1].body).toBe(call(0)[1].body);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it.each(UPLOADS)('%s does not retry a second time when the retry is also 401', async (_n, run) => {
    fetchMock
      .mockResolvedValueOnce(res(401))
      .mockResolvedValueOnce(res(200, { accessToken: 'new-token', user }))
      .mockResolvedValueOnce(res(401, { error: 'still unauthorized', code: 'UNAUTHORIZED' }));

    const err = await run().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it.each(UPLOADS)('%s gives up without retrying when the refresh fails', async (_n, run) => {
    fetchMock
      .mockResolvedValueOnce(res(401))
      .mockResolvedValueOnce(res(401));

    const err = await run().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe('Session expired');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });
});

describe('error mapping', () => {
  it.each(UPLOADS)('%s maps an API error body (code, message, details) to ApiError', async (_n, run) => {
    fetchMock.mockResolvedValueOnce(res(422, {
      error: 'File exceeds 20 MB limit', code: 'FILE_TOO_LARGE', details: { file: ['too large'] },
    }));
    const err = await run().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 422, code: 'FILE_TOO_LARGE', message: 'File exceeds 20 MB limit', details: { file: ['too large'] } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
