/**
 * LocalStorageDriver + signed-URL helpers. Pure filesystem / crypto: no DB.
 * Every test uses its own temp directory.
 */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createHmac } from 'crypto';
import { env } from '../src/utils/env';
import { LocalStorageDriver, defaultLocalStorageRoot } from '../src/services/storage/local';
import {
  isValidStorageKey,
  InvalidStorageKeyError,
  signFileUrl,
  verifyFileUrl,
  getFileUrlSecret,
  buildContentDisposition,
  computeFileUrlSignature,
  MAX_SIGNED_URL_TTL_SECONDS,
} from '../src/services/storage/signed-url';

type MutableEnv = Record<string, unknown>;

function withEnv<T>(overrides: Record<string, unknown>, fn: () => T): T {
  const mutable = env as unknown as MutableEnv;
  const saved: Record<string, unknown> = {};
  for (const key of Object.keys(overrides)) {
    saved[key] = mutable[key];
    mutable[key] = overrides[key];
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(saved)) mutable[key] = saved[key];
  }
}

let root: string;
let driver: LocalStorageDriver;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'storage-local-test-'));
  driver = new LocalStorageDriver(root);
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const TRAVERSAL_KEYS = [
  '../escape.txt',
  'a/../../escape.txt',
  'a/..',
  '..',
  '.',
  './a.txt',
  'a/./b.txt',
  '/etc/passwd',
  'C:/Windows/win.ini',
  'C:\\Windows\\win.ini',
  'a\\b.txt',
  '\\\\server\\share\\x',
  'a/b\u0000.txt',
  'a//b.txt',
  'a/',
  '',
  '.storage-meta/a.json',
  '.hidden',
  'a b.txt',
  'a/%2e%2e/b',
  'a/b?x=1',
  'nul',
  'CON.txt',
  'file.',
  'x'.repeat(513),
];

describe('storage keys', () => {
  it('accepts server-style nested keys', () => {
    expect(isValidStorageKey('daily-reports/c0mpany-1/r_2/photos/0f8e-uuid.jpg')).toBe(true);
    expect(isValidStorageKey('a.txt')).toBe(true);
  });

  it.each(TRAVERSAL_KEYS)('rejects %j', (key) => {
    expect(isValidStorageKey(key)).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(isValidStorageKey(undefined)).toBe(false);
    expect(isValidStorageKey(['a'])).toBe(false);
    expect(isValidStorageKey(42)).toBe(false);
  });
});

describe('LocalStorageDriver', () => {
  it('round-trips nested keys and records the content type', async () => {
    const key = 'daily-reports/company-1/report-1/photos/p1.jpg';
    const body = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02]);
    await driver.put(key, body, { contentType: 'image/jpeg' });

    expect(await driver.get(key)).toEqual(body);
    expect(await driver.getContentType(key)).toBe('image/jpeg');
    // Stored at <root>/<key>, sidecar outside the key namespace.
    expect(await fs.readFile(path.join(root, ...key.split('/')))).toEqual(body);
    await expect(fs.stat(path.join(root, '.storage-meta', ...key.split('/')) + '.json')).resolves.toBeTruthy();

    // Overwrite replaces bytes and type; no temp files are left behind.
    await driver.put(key, Buffer.from('%PDF-1.7'), { contentType: 'application/pdf' });
    expect((await driver.get(key))!.toString()).toBe('%PDF-1.7');
    expect(await driver.getContentType(key)).toBe('application/pdf');
    const leftovers = await fs.readdir(path.join(root, 'daily-reports/company-1/report-1/photos'));
    expect(leftovers).toEqual(['p1.jpg']);
  });

  it('get returns null for a missing key or a directory', async () => {
    expect(await driver.get('nope/missing.jpg')).toBeNull();
    await driver.put('dir/inner/file.png', Buffer.from('x'), { contentType: 'image/png' });
    expect(await driver.get('dir/inner')).toBeNull();
    expect(await driver.getContentType('nope/missing.jpg')).toBeNull();
  });

  it('delete is idempotent and removes the sidecar', async () => {
    const key = 'a/b/c.png';
    await driver.put(key, Buffer.from('png'), { contentType: 'image/png' });
    await driver.delete(key);
    expect(await driver.get(key)).toBeNull();
    expect(await driver.getContentType(key)).toBeNull();
    await expect(driver.delete(key)).resolves.toBeUndefined();
    await expect(driver.delete('never/existed.jpg')).resolves.toBeUndefined();
  });

  it.each(TRAVERSAL_KEYS)('rejects traversal key %j on every operation', async (key) => {
    await expect(driver.put(key, Buffer.from('x'), { contentType: 'text/plain' })).rejects.toBeInstanceOf(InvalidStorageKeyError);
    await expect(driver.get(key)).rejects.toBeInstanceOf(InvalidStorageKeyError);
    await expect(driver.delete(key)).rejects.toBeInstanceOf(InvalidStorageKeyError);
    await expect(driver.signedUrl(key, { expiresInSec: 300 })).rejects.toBeInstanceOf(InvalidStorageKeyError);
  });

  it('never writes outside its root for a rejected key', async () => {
    const parent = path.dirname(root);
    const before = await fs.readdir(parent);
    await driver.put('../escape-probe.txt', Buffer.from('x'), { contentType: 'text/plain' }).catch(() => undefined);
    const after = await fs.readdir(parent);
    expect(after.filter((n) => !before.includes(n))).toEqual([]);
  });

  it('signedUrl returns /api/v1/files/signed?k&e&s that verifies', async () => {
    const key = 'daily-reports/co/r/report.pdf';
    const now = Math.floor(Date.now() / 1000);
    const url = await driver.signedUrl(key, { expiresInSec: 300 });
    const parsed = new URL(url, 'http://localhost');
    expect(parsed.pathname).toBe('/api/v1/files/signed');
    expect([...parsed.searchParams.keys()].sort()).toEqual(['e', 'k', 's']);
    expect(parsed.searchParams.get('k')).toBe(key);
    const e = Number(parsed.searchParams.get('e'));
    expect(e).toBeGreaterThanOrEqual(now + 300);
    expect(e).toBeLessThanOrEqual(now + 302);
    expect(verifyFileUrl(Object.fromEntries(parsed.searchParams))).toEqual({ key, expiresAt: e });
  });

  it('signedUrl carries signed download name and content type', async () => {
    const url = await driver.signedUrl('a/report.pdf', {
      expiresInSec: 60, downloadName: 'DR-0042 Rev 1.pdf', contentType: 'application/pdf',
    });
    const q = Object.fromEntries(new URL(url, 'http://localhost').searchParams);
    expect(q['d']).toBe('DR-0042 Rev 1.pdf');
    expect(q['t']).toBe('application/pdf');
    expect(verifyFileUrl(q)).toMatchObject({ downloadName: 'DR-0042 Rev 1.pdf', contentType: 'application/pdf' });
  });

  it('signedUrl rejects out-of-range TTLs', async () => {
    for (const ttl of [0, -1, 1.5, MAX_SIGNED_URL_TTL_SECONDS + 1, Number.NaN]) {
      await expect(driver.signedUrl('a/b.jpg', { expiresInSec: ttl })).rejects.toBeInstanceOf(RangeError);
    }
  });

  it('default root matches the upload service test directory', () => {
    expect(defaultLocalStorageRoot()).toBe(path.join(os.tmpdir(), 'construction-platform-test-uploads'));
  });
});

describe('signed URL verification', () => {
  const now = 1_900_000_000;
  const params = { key: 'a/b/photo.jpg', expiresAt: now + 300 };

  function query(url: string): Record<string, string> {
    return Object.fromEntries(new URL(url, 'http://localhost').searchParams);
  }

  it('accepts a fresh URL', () => {
    expect(verifyFileUrl(query(signFileUrl(params)), now)).toEqual(params);
  });

  it('rejects tampered key, expiry, signature, download name and type', () => {
    const q = query(signFileUrl({ ...params, downloadName: 'a.jpg', contentType: 'image/jpeg' }));
    expect(verifyFileUrl(q, now)).not.toBeNull();
    expect(verifyFileUrl({ ...q, k: 'a/b/other.jpg' }, now)).toBeNull();
    expect(verifyFileUrl({ ...q, e: String(params.expiresAt + 1) }, now)).toBeNull();
    const flipped = (q['s']![0] === 'A' ? 'B' : 'A') + q['s']!.slice(1);
    expect(verifyFileUrl({ ...q, s: flipped }, now)).toBeNull();
    expect(verifyFileUrl({ ...q, d: 'evil.html' }, now)).toBeNull();
    expect(verifyFileUrl({ ...q, t: 'text/html' }, now)).toBeNull();
    const { d: _d, ...withoutD } = q;
    expect(verifyFileUrl(withoutD, now)).toBeNull();
  });

  it('rejects expired URLs (boundary inclusive)', () => {
    const q = query(signFileUrl(params));
    expect(verifyFileUrl(q, params.expiresAt - 1)).not.toBeNull();
    expect(verifyFileUrl(q, params.expiresAt)).toBeNull();
    expect(verifyFileUrl(q, params.expiresAt + 10)).toBeNull();
  });

  it('rejects an expiry further out than any URL we mint', () => {
    const far = { key: 'a/b.jpg', expiresAt: now + MAX_SIGNED_URL_TTL_SECONDS + 3600 };
    expect(verifyFileUrl(query(signFileUrl(far)), now)).toBeNull();
  });

  it('rejects malformed, missing and repeated parameters', () => {
    const q = query(signFileUrl(params));
    expect(verifyFileUrl(undefined, now)).toBeNull();
    expect(verifyFileUrl({}, now)).toBeNull();
    expect(verifyFileUrl({ k: q['k'], e: q['e'] }, now)).toBeNull();
    expect(verifyFileUrl({ ...q, k: [q['k'], q['k']] }, now)).toBeNull();
    expect(verifyFileUrl({ ...q, e: '0x70000000' }, now)).toBeNull();
    expect(verifyFileUrl({ ...q, e: `${q['e']}.0` }, now)).toBeNull();
    expect(verifyFileUrl({ ...q, s: q['s']!.slice(0, 20) }, now)).toBeNull();
    expect(verifyFileUrl({ ...q, s: `${q['s']}=` }, now)).toBeNull();
  });

  it('rejects a valid signature over an invalid key', () => {
    const key = '../secret.txt';
    const s = computeFileUrlSignature({ key, expiresAt: now + 60 });
    expect(verifyFileUrl({ k: key, e: String(now + 60), s }, now)).toBeNull();
  });

  it('rejects a URL signed with a different secret', () => {
    const other = Buffer.from('another-secret-that-is-at-least-32-chars');
    const q = query(signFileUrl(params, other));
    expect(verifyFileUrl(q, now)).toBeNull();
    expect(verifyFileUrl(q, now, other)).toEqual(params);
  });

  it('uses the timing-safe comparison', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const crypto = require('crypto') as typeof import('crypto');
    const spy = jest.spyOn(crypto, 'timingSafeEqual');
    try {
      verifyFileUrl(query(signFileUrl(params)), now);
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('file URL secret', () => {
  it('in test/dev falls back to a key derived from JWT_SECRET (not JWT_SECRET itself)', () => {
    withEnv({ FILE_URL_SECRET: '', isProduction: false }, () => {
      const derived = getFileUrlSecret();
      const expected = createHmac('sha256', env.JWT_SECRET).update('constructos:file-url-signing:v1').digest();
      expect(derived.equals(expected)).toBe(true);
      expect(derived.equals(Buffer.from(env.JWT_SECRET))).toBe(false);
    });
  });

  it('uses FILE_URL_SECRET when set', () => {
    const secret = 'test-fixture-file-url-secret-0123456789abcdef';
    withEnv({ FILE_URL_SECRET: secret }, () => {
      expect(getFileUrlSecret().toString('utf8')).toBe(secret);
    });
  });

  it('in production requires FILE_URL_SECRET of at least 32 characters, never echoing it', () => {
    const short = 'test-fixture-short';
    withEnv({ isProduction: true, FILE_URL_SECRET: '' }, () => {
      expect(() => getFileUrlSecret()).toThrow(/FILE_URL_SECRET/);
    });
    withEnv({ isProduction: true, FILE_URL_SECRET: short }, () => {
      let message = '';
      try { getFileUrlSecret(); } catch (err) { message = (err as Error).message; }
      expect(message).toMatch(/at least 32 characters/);
      expect(message).not.toContain(short);
    });
    withEnv({ isProduction: true, FILE_URL_SECRET: 'p'.repeat(32) }, () => {
      expect(getFileUrlSecret().length).toBe(32);
    });
  });

  it('verification fails closed (null) when the secret is unusable', () => {
    const q = Object.fromEntries(new URL(signFileUrl({ key: 'a/b.jpg', expiresAt: 1_900_000_300 }), 'http://x').searchParams);
    withEnv({ isProduction: true, FILE_URL_SECRET: '' }, () => {
      expect(verifyFileUrl(q, 1_900_000_000)).toBeNull();
    });
  });
});

describe('buildContentDisposition', () => {
  it('produces a safe attachment header', () => {
    expect(buildContentDisposition('DR-0042.pdf')).toBe(`attachment; filename="DR-0042.pdf"; filename*=UTF-8''DR-0042.pdf`);
    const tricky = buildContentDisposition('a"b\\c/d\r\nSet-Cookie: x.pdf');
    expect(tricky).not.toMatch(/[\r\n]/);
    expect(tricky.startsWith('attachment; filename="abcdSet-Cookie: x.pdf"')).toBe(true);
    expect(buildContentDisposition('Ripoti ya Siku – ñ.pdf')).toContain(`filename*=UTF-8''Ripoti%20ya%20Siku%20%E2%80%93%20%C3%B1.pdf`);
    expect(buildContentDisposition('""')).toContain('filename="download"');
  });
});
