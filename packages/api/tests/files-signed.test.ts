/**
 * GET /api/v1/files/signed — served from the local driver only, no JWT, and
 * every failure is the same 404. A minimal Fastify instance registers the
 * plugin exactly as server.ts will.
 */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { Writable } from 'stream';
import Fastify, { FastifyInstance } from 'fastify';
import { fileRoutes } from '../src/routes/files.routes';
import { LocalStorageDriver } from '../src/services/storage/local';
import { S3StorageDriver } from '../src/services/storage/s3';
import { MemoryStorageDriver } from '../src/services/storage/memory';
import { signFileUrl } from '../src/services/storage/signed-url';
import { resetStorageDriverForTests } from '../src/services/storage';
import { StorageDriver } from '../src/services/storage/types';
// The production logger configuration (strips query strings from req.url).
import { loggerOptions } from '../src/server';

const NOT_FOUND = { error: 'File not found', code: 'NOT_FOUND' };
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

let root: string;
let driver: LocalStorageDriver;
let app: FastifyInstance;
let logLines: string[];

async function buildTestApp(d: StorageDriver | undefined): Promise<FastifyInstance> {
  logLines = [];
  const stream = new Writable({
    write(chunk, _enc, cb) { logLines.push(String(chunk)); cb(); },
  });
  const instance = Fastify({ logger: { ...loggerOptions, level: 'trace', stream } });
  await instance.register(fileRoutes, { prefix: '/api/v1/files', ...(d ? { driver: d } : {}) });
  await instance.ready();
  return instance;
}

function urlOf(signed: string) {
  return new URL(signed, 'http://localhost');
}

function rebuild(u: URL, changes: Record<string, string | null>): string {
  const q = new URLSearchParams(u.searchParams);
  for (const [k, v] of Object.entries(changes)) {
    if (v === null) q.delete(k); else q.set(k, v);
  }
  return `${u.pathname}?${q.toString()}`;
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'files-signed-test-'));
  driver = new LocalStorageDriver(root);
  app = await buildTestApp(driver);
});

afterEach(async () => {
  await app.close();
  await fs.rm(root, { recursive: true, force: true });
  jest.useRealTimers();
});

describe('GET /api/v1/files/signed', () => {
  it('serves the bytes for a valid signed URL with safe headers', async () => {
    const key = 'daily-reports/co-1/r-1/photos/p1.jpg';
    await driver.put(key, JPEG, { contentType: 'image/jpeg' });
    const signed = await driver.signedUrl(key, { expiresInSec: 300 });

    const res = await app.inject({ method: 'GET', url: signed });
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload).toEqual(JPEG);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['cache-control']).toBe('private, max-age=300');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-disposition']).toBe('inline');
    expect(Number(res.headers['content-length'])).toBe(JPEG.length);
  });

  it('needs no Authorization header and ignores one', async () => {
    const key = 'a/b.jpg';
    await driver.put(key, JPEG, { contentType: 'image/jpeg' });
    const signed = await driver.signedUrl(key, { expiresInSec: 60 });
    const res = await app.inject({ method: 'GET', url: signed, headers: { authorization: 'Bearer junk' } });
    expect(res.statusCode).toBe(200);
  });

  it('serves a signed download name as an attachment and signed type wins', async () => {
    const key = 'daily-reports/co/r/report.pdf';
    await driver.put(key, Buffer.from('%PDF-1.7'), { contentType: 'application/octet-stream' });
    const signed = await driver.signedUrl(key, {
      expiresInSec: 300, downloadName: 'DR-0042 Rev 1.pdf', contentType: 'application/pdf',
    });
    const res = await app.inject({ method: 'GET', url: signed });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition'])
      .toBe(`attachment; filename="DR-0042 Rev 1.pdf"; filename*=UTF-8''DR-0042%20Rev%201.pdf`);
  });

  it('content type: sidecar, then extension, else octet-stream; never an unsafe type', async () => {
    // Sidecar
    await driver.put('a/noext', Buffer.from('x'), { contentType: 'image/png' });
    // No sidecar: write raw files directly under the root
    await fs.mkdir(path.join(root, 'raw'), { recursive: true });
    for (const name of ['p.jpg', 'p.png', 'd.pdf', 'x.bin', 'u.JPEG']) {
      await fs.writeFile(path.join(root, 'raw', name), 'x');
    }
    // Unsafe stored type is downgraded
    await driver.put('a/page.html', Buffer.from('<script>alert(1)</script>'), { contentType: 'text/html' });

    const expectType = async (key: string, type: string, signedType?: string) => {
      const res = await app.inject({
        method: 'GET',
        url: await driver.signedUrl(key, { expiresInSec: 60, ...(signedType ? { contentType: signedType } : {}) }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe(type);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    };
    await expectType('a/noext', 'image/png');
    await expectType('raw/p.jpg', 'image/jpeg');
    await expectType('raw/u.JPEG', 'image/jpeg');
    await expectType('raw/p.png', 'image/png');
    await expectType('raw/d.pdf', 'application/pdf');
    await expectType('raw/x.bin', 'application/octet-stream');
    await expectType('a/page.html', 'application/octet-stream');
    await expectType('a/page.html', 'application/octet-stream', 'text/html');
  });

  describe('every failure is the same 404', () => {
    const key = 'daily-reports/co/r/photos/p.jpg';
    let signed: URL;

    beforeEach(async () => {
      await driver.put(key, JPEG, { contentType: 'image/jpeg' });
      await driver.put('daily-reports/co/r/photos/other.jpg', JPEG, { contentType: 'image/jpeg' });
      signed = urlOf(await driver.signedUrl(key, { expiresInSec: 300 }));
      // Sanity: the untampered URL works.
      const ok = await app.inject({ method: 'GET', url: `${signed.pathname}${signed.search}` });
      expect(ok.statusCode).toBe(200);
    });

    const cases: Array<[string, (u: URL) => string]> = [
      ['tampered key', (u) => rebuild(u, { k: 'daily-reports/co/r/photos/other.jpg' })],
      ['tampered expiry', (u) => rebuild(u, { e: String(Number(u.searchParams.get('e')) + 60) })],
      ['tampered signature', (u) => {
        const s = u.searchParams.get('s')!;
        return rebuild(u, { s: (s[0] === 'A' ? 'B' : 'A') + s.slice(1) });
      }],
      ['added download name', (u) => rebuild(u, { d: 'evil.html' })],
      ['added content type', (u) => rebuild(u, { t: 'text/html' })],
      ['missing signature', (u) => rebuild(u, { s: null })],
      ['missing expiry', (u) => rebuild(u, { e: null })],
      ['missing key', (u) => rebuild(u, { k: null })],
      ['repeated key', (u) => `${u.pathname}${u.search}&k=${encodeURIComponent(key)}`],
      ['traversal key', (u) => rebuild(u, { k: '../../etc/passwd' })],
      ['no query', (u) => u.pathname],
    ];

    it.each(cases)('%s → 404', async (_name, mutate) => {
      const res = await app.inject({ method: 'GET', url: mutate(signed) });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual(NOT_FOUND);
    });

    it('expired → 404', async () => {
      const short = urlOf(await driver.signedUrl(key, { expiresInSec: 1 }));
      jest.useFakeTimers({ now: Date.now() + 5_000, doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout'] });
      const res = await app.inject({ method: 'GET', url: `${short.pathname}${short.search}` });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual(NOT_FOUND);
    });

    it('validly signed but already-expired expiry → 404', async () => {
      const past = signFileUrl({ key, expiresAt: Math.floor(Date.now() / 1000) - 1 });
      const res = await app.inject({ method: 'GET', url: past });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual(NOT_FOUND);
    });

    it('valid signature for a deleted object → 404', async () => {
      await driver.delete(key);
      const res = await app.inject({ method: 'GET', url: `${signed.pathname}${signed.search}` });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual(NOT_FOUND);
    });

    it('never logs the query string', async () => {
      await app.inject({ method: 'GET', url: `${signed.pathname}${signed.search}` });
      await app.inject({ method: 'GET', url: rebuild(signed, { s: 'A'.repeat(43) }) });
      const logged = logLines.join('\n');
      expect(logged).toContain('/api/v1/files/signed');
      expect(logged).not.toContain(signed.searchParams.get('s')!);
      expect(logged).not.toContain('A'.repeat(43));
      expect(logged).not.toContain('k=');
      // The route adds no log lines of its own.
      const ownLines = logLines.filter((l) => !/"msg":"(incoming request|request completed)"/.test(l));
      expect(ownLines).toEqual([]);
    });
  });

  it('returns 404 when the active driver is S3 (URLs go straight to the bucket)', async () => {
    const s3 = new S3StorageDriver({
      // TEST FIXTURES, not real
      bucket: 'test-fixture-bucket', region: 'auto', endpoint: 'https://test-fixture.invalid',
      accessKeyId: 'TEST_FIXTURE_ACCESS_KEY_ID', secretAccessKey: 'test-fixture-secret-access-key-not-real',
      forcePathStyle: true,
    });
    const s3App = await buildTestApp(s3);
    try {
      await driver.put('a/b.jpg', JPEG, { contentType: 'image/jpeg' });
      const signed = await driver.signedUrl('a/b.jpg', { expiresInSec: 60 });
      const res = await s3App.inject({ method: 'GET', url: signed });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual(NOT_FOUND);
    } finally {
      await s3App.close();
    }
  });

  it('returns 404 for a non-local driver such as the memory driver', async () => {
    const mem = new MemoryStorageDriver();
    await mem.put('a/b.jpg', JPEG, { contentType: 'image/jpeg' });
    const memApp = await buildTestApp(mem);
    try {
      const res = await memApp.inject({ method: 'GET', url: signFileUrl({ key: 'a/b.jpg', expiresAt: Math.floor(Date.now() / 1000) + 60 }) });
      expect(res.statusCode).toBe(404);
    } finally {
      await memApp.close();
    }
  });

  it('defaults to getStorageDriver() (local under test) when no driver is injected', async () => {
    resetStorageDriverForTests();
    const defaultApp = await buildTestApp(undefined);
    try {
      const { getStorageDriver } = await import('../src/services/storage');
      const d = getStorageDriver();
      expect(d).toBeInstanceOf(LocalStorageDriver);
      const key = `files-signed-test/${Date.now()}-${Math.random().toString(36).slice(2)}.png`;
      await d.put(key, Buffer.from('png-bytes'), { contentType: 'image/png' });
      try {
        const res = await defaultApp.inject({ method: 'GET', url: await d.signedUrl(key, { expiresInSec: 60 }) });
        expect(res.statusCode).toBe(200);
        expect(res.body).toBe('png-bytes');
      } finally {
        await d.delete(key);
      }
    } finally {
      await defaultApp.close();
      resetStorageDriverForTests();
    }
  });
});
