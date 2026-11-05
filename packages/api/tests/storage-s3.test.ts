/**
 * S3StorageDriver against a stub HTTP handler: requests go through the real
 * SDK middleware stack (serialisation, signing) but never reach the network.
 * Presigning is purely local. All credentials / endpoints / buckets below are
 * obviously fake TEST FIXTURES.
 */
import { Readable } from 'stream';
import { S3Client } from '@aws-sdk/client-s3';
import { S3StorageDriver, createS3Client } from '../src/services/storage/s3';
import { InvalidStorageKeyError } from '../src/services/storage/signed-url';

// ── Test fixtures (not real) ────────────────────────────────────────────────
const FIXTURE = {
  bucket: 'test-fixture-bucket',
  region: 'auto',
  endpoint: 'https://test-fixture.invalid',
  accessKeyId: 'TEST_FIXTURE_ACCESS_KEY_ID',
  secretAccessKey: 'test-fixture-secret-access-key-not-real',
  forcePathStyle: true,
};

interface CapturedRequest {
  method: string;
  hostname: string;
  path: string;
  headers: Record<string, string>;
  body: Buffer | null;
}

type StubResponse = { statusCode: number; headers?: Record<string, string>; body?: string | Buffer };

function bodyToBuffer(body: unknown): Buffer | null {
  if (body === undefined || body === null) return null;
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof body === 'string') return Buffer.from(body);
  return null;
}

/** An S3Client whose transport is a stub: records requests, replays canned responses. */
function stubClient(respond: (req: CapturedRequest) => StubResponse) {
  const requests: CapturedRequest[] = [];
  const requestHandler = {
    metadata: { handlerProtocol: 'http/1.1' },
    async handle(request: { method: string; hostname: string; path: string; headers: Record<string, string>; body?: unknown }) {
      const captured: CapturedRequest = {
        method: request.method,
        hostname: request.hostname,
        path: request.path,
        headers: Object.fromEntries(Object.entries(request.headers).map(([k, v]) => [k.toLowerCase(), v])),
        body: bodyToBuffer(request.body),
      };
      requests.push(captured);
      const res = respond(captured);
      const payload = res.body === undefined ? Buffer.alloc(0) : Buffer.from(res.body);
      return {
        response: {
          statusCode: res.statusCode,
          reason: undefined,
          headers: { 'content-length': String(payload.length), ...(res.headers ?? {}) },
          body: Readable.from([payload]),
        },
      };
    },
    updateHttpClientConfig() {},
    httpHandlerConfigs() { return {}; },
    destroy() {},
  };
  const client = new S3Client({
    region: FIXTURE.region,
    endpoint: FIXTURE.endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: FIXTURE.accessKeyId, secretAccessKey: FIXTURE.secretAccessKey },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    maxAttempts: 1,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    requestHandler: requestHandler as any,
  });
  return { client, requests };
}

const NO_SUCH_KEY_XML =
  '<?xml version="1.0" encoding="UTF-8"?><Error><Code>NoSuchKey</Code>' +
  '<Message>The specified key does not exist.</Message><Key>x</Key></Error>';

describe('S3StorageDriver with a stub transport', () => {
  it('put sends ContentType and CacheControl private, no-store', async () => {
    const { client, requests } = stubClient(() => ({ statusCode: 200, headers: { etag: '"abc"' } }));
    const driver = new S3StorageDriver({ ...FIXTURE, client });
    const body = Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3]);
    await driver.put('daily-reports/co/r/photos/p.jpg', body, { contentType: 'image/jpeg' });

    expect(requests).toHaveLength(1);
    const req = requests[0]!;
    expect(req.method).toBe('PUT');
    expect(req.path).toBe('/test-fixture-bucket/daily-reports/co/r/photos/p.jpg');
    expect(req.headers['content-type']).toBe('image/jpeg');
    expect(req.headers['cache-control']).toBe('private, no-store');
    expect(req.headers['authorization']).toMatch(/^AWS4-HMAC-SHA256 Credential=TEST_FIXTURE_ACCESS_KEY_ID\//);
    expect(req.body).toEqual(body);
  });

  it('get returns the object bytes', async () => {
    const stored = Buffer.from('%PDF-1.7 fixture');
    const { client, requests } = stubClient(() => ({
      statusCode: 200, headers: { 'content-type': 'application/pdf' }, body: stored,
    }));
    const driver = new S3StorageDriver({ ...FIXTURE, client });
    expect(await driver.get('a/b/report.pdf')).toEqual(stored);
    expect(requests[0]!.method).toBe('GET');
    expect(requests[0]!.path).toBe('/test-fixture-bucket/a/b/report.pdf');
  });

  it('get returns null on NoSuchKey', async () => {
    const { client } = stubClient(() => ({
      statusCode: 404, headers: { 'content-type': 'application/xml' }, body: NO_SUCH_KEY_XML,
    }));
    const driver = new S3StorageDriver({ ...FIXTURE, client });
    await expect(driver.get('missing/key.jpg')).resolves.toBeNull();
  });

  it('get propagates other errors', async () => {
    const { client } = stubClient(() => ({
      statusCode: 403, headers: { 'content-type': 'application/xml' },
      body: '<?xml version="1.0"?><Error><Code>AccessDenied</Code><Message>denied</Message></Error>',
    }));
    const driver = new S3StorageDriver({ ...FIXTURE, client });
    await expect(driver.get('a/b.jpg')).rejects.toMatchObject({ name: 'AccessDenied' });
  });

  it('delete is idempotent (204 and 404 both succeed)', async () => {
    let status = 204;
    const { client, requests } = stubClient(() => (
      status === 404
        ? { statusCode: 404, headers: { 'content-type': 'application/xml' }, body: NO_SUCH_KEY_XML }
        : { statusCode: 204 }
    ));
    const driver = new S3StorageDriver({ ...FIXTURE, client });
    await expect(driver.delete('a/b.jpg')).resolves.toBeUndefined();
    status = 404;
    await expect(driver.delete('a/b.jpg')).resolves.toBeUndefined();
    expect(requests.map((r) => r.method)).toEqual(['DELETE', 'DELETE']);
  });

  it('rejects invalid keys before any request', async () => {
    const { client, requests } = stubClient(() => ({ statusCode: 200 }));
    const driver = new S3StorageDriver({ ...FIXTURE, client });
    await expect(driver.put('../x.jpg', Buffer.from('x'), { contentType: 'image/jpeg' })).rejects.toBeInstanceOf(InvalidStorageKeyError);
    await expect(driver.get('/abs.jpg')).rejects.toBeInstanceOf(InvalidStorageKeyError);
    await expect(driver.delete('a\\b.jpg')).rejects.toBeInstanceOf(InvalidStorageKeyError);
    await expect(driver.signedUrl('a/../b', { expiresInSec: 60 })).rejects.toBeInstanceOf(InvalidStorageKeyError);
    expect(requests).toHaveLength(0);
  });
});

describe('S3StorageDriver.signedUrl (offline presign)', () => {
  it('presigns GetObject with the expiry, disposition and content type, without any request', async () => {
    const { client, requests } = stubClient(() => { throw new Error('network must not be used'); });
    const driver = new S3StorageDriver({ ...FIXTURE, client });
    const url = new URL(await driver.signedUrl('daily-reports/co/r/report.pdf', {
      expiresInSec: 300, downloadName: 'DR-0042 Rev 1.pdf', contentType: 'application/pdf',
    }));

    expect(requests).toHaveLength(0);
    expect(url.origin).toBe('https://test-fixture.invalid');
    expect(url.pathname).toBe('/test-fixture-bucket/daily-reports/co/r/report.pdf');
    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('X-Amz-Credential')).toMatch(/^TEST_FIXTURE_ACCESS_KEY_ID\/\d{8}\/auto\/s3\/aws4_request$/);
    expect(url.searchParams.get('response-content-disposition'))
      .toBe(`attachment; filename="DR-0042 Rev 1.pdf"; filename*=UTF-8''DR-0042%20Rev%201.pdf`);
    expect(url.searchParams.get('response-content-type')).toBe('application/pdf');
  });

  it('omits response overrides when not requested and honours a short TTL', async () => {
    const driver = new S3StorageDriver({ ...FIXTURE });
    const url = new URL(await driver.signedUrl('a/b.jpg', { expiresInSec: 60 }));
    expect(url.searchParams.get('X-Amz-Expires')).toBe('60');
    expect(url.searchParams.has('response-content-disposition')).toBe(false);
    expect(url.searchParams.has('response-content-type')).toBe(false);
  });

  it('rejects out-of-range TTLs', async () => {
    const driver = new S3StorageDriver({ ...FIXTURE });
    await expect(driver.signedUrl('a/b.jpg', { expiresInSec: 0 })).rejects.toBeInstanceOf(RangeError);
    await expect(driver.signedUrl('a/b.jpg', { expiresInSec: 7 * 24 * 3600 + 1 })).rejects.toBeInstanceOf(RangeError);
  });

  it('supports virtual-hosted style when forcePathStyle is false', async () => {
    const client = createS3Client({ ...FIXTURE, forcePathStyle: false });
    const driver = new S3StorageDriver({ bucket: FIXTURE.bucket, client, region: FIXTURE.region, accessKeyId: '', secretAccessKey: '' });
    const url = new URL(await driver.signedUrl('a/b.jpg', { expiresInSec: 60 }));
    expect(url.hostname).toBe('test-fixture-bucket.test-fixture.invalid');
    expect(url.pathname).toBe('/a/b.jpg');
  });
});
