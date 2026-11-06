/**
 * Uploaded files (delivery photos/documents, drawing revisions, instruction
 * attachments) are served by the API at GET /uploads/* behind a Bearer token.
 * Regression: the web linked to `/api/v1/uploads/...` (API 404) or to
 * `/uploads/...` on the web origin (Next 404) with no token, so no uploaded
 * file could be viewed or downloaded.
 */
import { ApiError } from '@/lib/api';
import { describeFileError, fetchUploadedFile, uploadedFileUrl } from '@/lib/workflows-files';

const ORIGIN = 'https://api.example.test';

describe('uploadedFileUrl', () => {
  it('maps a stored /uploads/ path onto the API origin (not /api/v1)', () => {
    expect(uploadedFileUrl('/uploads/photos/abc.jpg', ORIGIN)).toBe(`${ORIGIN}/uploads/photos/abc.jpg`);
  });

  it('accepts the legacy /api/v1/uploads/ form', () => {
    expect(uploadedFileUrl('/api/v1/uploads/documents/x.pdf', ORIGIN)).toBe(`${ORIGIN}/uploads/documents/x.pdf`);
  });

  it.each([
    [''],
    [null],
    [undefined],
    ['https://evil.example/uploads/x.jpg'],
    ['//evil.example/uploads/x.jpg'],
    ['/api/v1/projects'],
    ['/uploads/'],
    ['/uploads/../.env'],
    ['/uploads/photos/../../secret'],
    ['/uploads/photos//x.jpg'],
    // Inputs the WHATWG URL parser would normalise onto another API path.
    ['/uploads/%2e%2e/api/v1/auth/me'],
    ['/uploads/.%2E/api/v1/auth/me'],
    ['/uploads/%2E./api/v1/auth/me'],
    ['/uploads/..\\api/v1/auth/me'],
    ['/uploads/photos\\..\\..\\api/v1/auth/me'],
    ['/uploads/photos%2F..%2F..%2Fapi'],
    ['/uploads/photos/a%00.jpg'],
    ['/uploads/photos/a%0a.jpg'],
    ['/uploads/photos/a\u0000.jpg'],
    ['/uploads/photos/a\n.jpg'],
    ['/uploads/photos/a\t.jpg'],
    ['/uploads/photos/a .jpg'],
    ['/uploads//evil.com/x.jpg'],
    ['/uploads/\\\\evil.com/x.jpg'],
    ['/api/v1/uploads/%2e%2e/api/v1/auth/me'],
    ['/uploads/photos/a.jpg?redirect=1'],
    ['/uploads/photos/a.jpg#frag'],
    ['/uploads/photos/a@evil.com'],
  ])('rejects %p so the token is never sent elsewhere', (value) => {
    expect(uploadedFileUrl(value as string | null | undefined, ORIGIN)).toBeNull();
  });

  it('positive control: a real API key shape is accepted', () => {
    const key = '/uploads/photos/0b6f3c2e-1a2b-4c5d-8e9f-0123456789ab.jpeg';
    expect(uploadedFileUrl(key, ORIGIN)).toBe(`${ORIGIN}${key}`);
  });

  it('keeps a path prefix on the API URL and still pins the origin', () => {
    expect(uploadedFileUrl('/uploads/a/b.png', 'https://h.test/api/')).toBe('https://h.test/api/uploads/a/b.png');
  });

  it('rejects an unparseable API origin', () => {
    expect(uploadedFileUrl('/uploads/a/b.png', 'not a url')).toBeNull();
  });

  it('defaults to NEXT_PUBLIC_API_URL without a trailing slash', () => {
    const prev = process.env.NEXT_PUBLIC_API_URL;
    process.env.NEXT_PUBLIC_API_URL = 'https://api.prod.test/';
    try {
      expect(uploadedFileUrl('/uploads/a/b.png')).toBe('https://api.prod.test/uploads/a/b.png');
    } finally {
      process.env.NEXT_PUBLIC_API_URL = prev;
    }
  });
});

type FakeRes = { status: number; ok: boolean; json: () => Promise<unknown>; blob: () => Promise<Blob> };
function res(status: number, opts: { body?: unknown; blob?: Blob } = {}): FakeRes {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => { if (opts.body === undefined) throw new Error('no json'); return opts.body; },
    blob: async () => opts.blob ?? new Blob(['x']),
  };
}

describe('fetchUploadedFile', () => {
  beforeEach(() => { process.env.NEXT_PUBLIC_API_URL = ORIGIN; });

  it('sends the Bearer token to the API /uploads URL without cookies', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(res(200, { blob: new Blob(['img'], { type: 'image/png' }) }));
    const blob = await fetchUploadedFile('/uploads/photos/a.png', {
      getToken: () => 'tok-1', refresh: jest.fn(), fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${ORIGIN}/uploads/photos/a.png`);
    expect(init.headers).toEqual({ Authorization: 'Bearer tok-1' });
    expect(init.credentials).toBe('omit');
    expect(blob.type).toBe('image/png');
  });

  it('refreshes once on 401 and retries with the new token', async () => {
    let token = 'expired';
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(res(401, { body: { error: 'Invalid or expired token' } }))
      .mockResolvedValueOnce(res(200));
    const refresh = jest.fn(async () => { token = 'fresh'; return true; });
    await fetchUploadedFile('/uploads/documents/d.pdf', {
      getToken: () => token, refresh, fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[1][1].headers).toEqual({ Authorization: 'Bearer fresh' });
  });

  it('does not retry when the refresh fails, and reports the 401', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(res(401, { body: { error: 'Invalid or expired token', code: 'UNAUTHORIZED' } }));
    const err = await fetchUploadedFile('/uploads/x/y.pdf', {
      getToken: () => 't', refresh: async () => false, fetchImpl: fetchImpl as unknown as typeof fetch,
    }).catch((e) => e);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
    expect(describeFileError(err)).toMatch(/session has expired/i);
  });

  it('turns a 404 (missing file or no access) into a readable message', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(res(404, { body: { error: 'File not found', code: 'NOT_FOUND' } }));
    const err = await fetchUploadedFile('/uploads/x/y.pdf', {
      getToken: () => 't', refresh: jest.fn(), fetchImpl: fetchImpl as unknown as typeof fetch,
    }).catch((e) => e);
    expect(describeFileError(err)).toBe('File not found or you no longer have access to it');
  });

  it('reports a network failure instead of throwing a raw TypeError', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const err = await fetchUploadedFile('/uploads/x/y.pdf', {
      getToken: () => 't', refresh: jest.fn(), fetchImpl: fetchImpl as unknown as typeof fetch,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(describeFileError(err)).toMatch(/could not reach the server/i);
  });

  it('applies the stored MIME type when the server sends octet-stream', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(res(200, { blob: new Blob(['%PDF'], { type: 'application/octet-stream' }) }));
    const blob = await fetchUploadedFile('/uploads/documents/d.pdf', {
      getToken: () => 't', refresh: jest.fn(), fetchImpl: fetchImpl as unknown as typeof fetch,
    }, 'application/pdf');
    expect(blob.type).toBe('application/pdf');
  });

  it('refuses an invalid stored URL without calling fetch', async () => {
    const fetchImpl = jest.fn();
    const err = await fetchUploadedFile('https://evil.example/uploads/x', {
      getToken: () => 't', refresh: jest.fn(), fetchImpl: fetchImpl as unknown as typeof fetch,
    }).catch((e) => e);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(err).toBeInstanceOf(ApiError);
  });
});
