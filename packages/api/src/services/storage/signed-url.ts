import { createHmac, timingSafeEqual } from 'crypto';
import { env } from '../../utils/env';

/**
 * Shared helpers for private storage:
 *  - storage-key validation (both drivers and the signed-URL route use it),
 *  - HMAC signing / verification of the local driver's short-lived file URLs,
 *  - Content-Disposition construction.
 *
 * Signed local URL shape:
 *   /api/v1/files/signed?k=<key>&e=<unix expiry seconds>[&d=<download name>][&t=<content type>]&s=<sig>
 * where sig = base64url(HMAC-SHA256(secret, JSON.stringify(['v1', k, e, d ?? '', t ?? '']))).
 * The optional d / t parameters are covered by the signature, so a holder of
 * the URL cannot change the served file name or content type.
 */

export const SIGNED_FILE_PATH = '/api/v1/files/signed';

/** Upper bound on any signed URL lifetime (matches the S3 SigV4 maximum). */
export const MAX_SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60;

const MAX_KEY_LENGTH = 512;
const MAX_DOWNLOAD_NAME_LENGTH = 200;
const MAX_CONTENT_TYPE_LENGTH = 100;
const SIGNATURE_VERSION = 'v1';
const FALLBACK_DERIVATION_LABEL = 'constructos:file-url-signing:v1';

// ── Storage keys ─────────────────────────────────────────────────────────────

export class InvalidStorageKeyError extends Error {
  constructor() {
    // Never echo the key: it may be attacker-supplied.
    super('Invalid storage key');
    this.name = 'InvalidStorageKeyError';
  }
}

// One path segment: starts with a letter, digit, '_' or '-' (so never '.', '..'
// or a hidden name), then letters, digits, '.', '_' or '-'; must not end in '.'
// (Windows silently strips trailing dots).
const SEGMENT_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
// Windows reserved device names, with or without an extension.
const WINDOWS_DEVICE_RE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/**
 * Keys are server-generated and '/'-separated, e.g.
 * `daily-reports/{companyId}/{reportId}/photos/{uuid}.jpg`.
 * This is an allow-list, so '..' segments, absolute paths ('/x', 'C:\x', '\\x'),
 * backslashes, null bytes, empty segments, whitespace and URL metacharacters
 * are all rejected.
 */
export function isValidStorageKey(key: unknown): key is string {
  if (typeof key !== 'string' || key.length === 0 || key.length > MAX_KEY_LENGTH) return false;
  const segments = key.split('/');
  return segments.every((segment) =>
    SEGMENT_RE.test(segment) && !segment.endsWith('.') && !WINDOWS_DEVICE_RE.test(segment),
  );
}

export function assertValidStorageKey(key: unknown): asserts key is string {
  if (!isValidStorageKey(key)) throw new InvalidStorageKeyError();
}

export function assertValidTtl(expiresInSec: number): void {
  if (!Number.isInteger(expiresInSec) || expiresInSec < 1 || expiresInSec > MAX_SIGNED_URL_TTL_SECONDS) {
    throw new RangeError(`expiresInSec must be an integer between 1 and ${MAX_SIGNED_URL_TTL_SECONDS}`);
  }
}

// ── Content-Disposition ──────────────────────────────────────────────────────

/**
 * `attachment` with an ASCII fallback filename plus an RFC 5987 UTF-8 name.
 * Quotes, backslashes, control characters and path separators are removed.
 */
export function buildContentDisposition(downloadName: string): string {
  const cleaned = downloadName
    .replace(/[\u0000-\u001f\u007f"\\/]/g, '')
    .trim()
    .slice(0, MAX_DOWNLOAD_NAME_LENGTH) || 'download';
  const ascii = cleaned.replace(/[^\x20-\x7e]/g, '_');
  const encoded = encodeURIComponent(cleaned).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

// ── Secret ───────────────────────────────────────────────────────────────────

/**
 * HMAC key for local signed URLs.
 *  - FILE_URL_SECRET when set. In production it is required and must be at
 *    least 32 characters (startup throws otherwise when the local driver is used).
 *  - development / test only: when FILE_URL_SECRET is empty, a key derived from
 *    JWT_SECRET via HMAC-SHA256(JWT_SECRET, 'constructos:file-url-signing:v1').
 *    The derived key is domain-separated, so it can never be used as a JWT key.
 * Read at call time so tests can toggle `env` fields.
 */
export function getFileUrlSecret(): Buffer {
  const configured = env.FILE_URL_SECRET;
  if (env.isProduction) {
    if (!configured || configured.length < 32) {
      throw new Error(
        'FILE_URL_SECRET must be set to at least 32 characters in production when STORAGE_DRIVER=local. ' +
        `Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
      );
    }
    return Buffer.from(configured, 'utf8');
  }
  if (configured) return Buffer.from(configured, 'utf8');
  return createHmac('sha256', env.JWT_SECRET).update(FALLBACK_DERIVATION_LABEL).digest();
}

// ── Sign / verify ────────────────────────────────────────────────────────────

export interface SignFileUrlParams {
  key: string;
  /** Unix seconds. */
  expiresAt: number;
  downloadName?: string;
  contentType?: string;
}

export interface VerifiedFileUrl {
  key: string;
  expiresAt: number;
  downloadName?: string;
  contentType?: string;
}

export function computeFileUrlSignature(params: SignFileUrlParams, secret: Buffer = getFileUrlSecret()): string {
  const payload = JSON.stringify([
    SIGNATURE_VERSION,
    params.key,
    String(params.expiresAt),
    params.downloadName ?? '',
    params.contentType ?? '',
  ]);
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/** Returns the signed relative URL (path + query). */
export function signFileUrl(params: SignFileUrlParams, secret: Buffer = getFileUrlSecret()): string {
  assertValidStorageKey(params.key);
  if (!Number.isSafeInteger(params.expiresAt) || params.expiresAt <= 0) {
    throw new RangeError('expiresAt must be a positive integer (unix seconds)');
  }
  if (params.downloadName !== undefined && params.downloadName.length > MAX_DOWNLOAD_NAME_LENGTH) {
    throw new RangeError(`downloadName must be at most ${MAX_DOWNLOAD_NAME_LENGTH} characters`);
  }
  if (params.contentType !== undefined && params.contentType.length > MAX_CONTENT_TYPE_LENGTH) {
    throw new RangeError(`contentType must be at most ${MAX_CONTENT_TYPE_LENGTH} characters`);
  }
  const query = new URLSearchParams();
  query.set('k', params.key);
  query.set('e', String(params.expiresAt));
  if (params.downloadName) query.set('d', params.downloadName);
  if (params.contentType) query.set('t', params.contentType);
  query.set('s', computeFileUrlSignature(params, secret));
  return `${SIGNED_FILE_PATH}?${query.toString()}`;
}

function singleString(value: unknown, maxLength: number): string | undefined | null {
  if (value === undefined) return undefined;
  // Repeated parameters arrive as arrays: refuse rather than guess.
  if (typeof value !== 'string' || value.length > maxLength) return null;
  return value;
}

/**
 * Verifies a parsed query (`{ k, e, s, d?, t? }`). Returns null on ANY problem:
 * missing / repeated / malformed parameter, invalid key, bad signature,
 * expired, or an expiry further out than any URL we would mint.
 */
export function verifyFileUrl(
  query: Record<string, unknown> | null | undefined,
  nowSec: number = Math.floor(Date.now() / 1000),
  secret?: Buffer,
): VerifiedFileUrl | null {
  if (!query || typeof query !== 'object') return null;
  const k = singleString(query['k'], MAX_KEY_LENGTH);
  const e = singleString(query['e'], 12);
  const s = singleString(query['s'], 64);
  const d = singleString(query['d'], MAX_DOWNLOAD_NAME_LENGTH);
  const t = singleString(query['t'], MAX_CONTENT_TYPE_LENGTH);
  if (!k || !e || !s || d === null || t === null) return null;
  if (!isValidStorageKey(k)) return null;
  if (!/^[1-9][0-9]{0,11}$/.test(e)) return null;
  if (!/^[A-Za-z0-9_-]{43}$/.test(s)) return null;

  const expiresAt = Number(e);
  const params: SignFileUrlParams = {
    key: k,
    expiresAt,
    ...(d ? { downloadName: d } : {}),
    ...(t ? { contentType: t } : {}),
  };

  let key: Buffer;
  try {
    key = secret ?? getFileUrlSecret();
  } catch {
    return null;
  }
  const expected = Buffer.from(computeFileUrlSignature(params, key), 'utf8');
  const given = Buffer.from(s, 'utf8');
  // Both are 43-char base64url strings at this point, so lengths match.
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  if (expiresAt <= nowSec) return null;
  if (expiresAt > nowSec + MAX_SIGNED_URL_TTL_SECONDS + 60) return null;
  return params as VerifiedFileUrl;
}
