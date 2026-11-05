import { env } from '../../utils/env';
import { StorageDriver } from './types';
import { LocalStorageDriver } from './local';
import { S3StorageDriver } from './s3';
import { getFileUrlSecret } from './signed-url';

export type { StorageDriver } from './types';
export { SIGNED_URL_TTL_SECONDS } from './types';
export { LocalStorageDriver } from './local';
export { S3StorageDriver } from './s3';

let cached: StorageDriver | undefined;

/** Env vars the s3 driver cannot run without. S3_ENDPOINT is optional (AWS S3 needs none). */
const REQUIRED_S3_ENV = ['S3_BUCKET', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const;

function createDriverFromEnv(): StorageDriver {
  if (env.STORAGE_DRIVER === 's3') {
    const missing = REQUIRED_S3_ENV.filter((name) => !String(env[name] ?? '').trim());
    if (missing.length > 0) {
      throw new Error(`STORAGE_DRIVER=s3 requires these environment variables: ${missing.join(', ')}`);
    }
    const endpoint = env.S3_ENDPOINT.trim();
    if (endpoint) {
      let url: URL;
      try {
        url = new URL(endpoint);
      } catch {
        throw new Error('S3_ENDPOINT must be an absolute URL');
      }
      if (env.isProduction && url.protocol !== 'https:') {
        throw new Error('S3_ENDPOINT must use https in production');
      }
    }
    return new S3StorageDriver({
      bucket: env.S3_BUCKET.trim(),
      region: env.S3_REGION.trim(),
      ...(endpoint ? { endpoint } : {}),
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    });
  }

  if (env.isProduction && !env.ALLOW_LOCAL_STORAGE_IN_PRODUCTION) {
    throw new Error(
      'STORAGE_DRIVER=local is refused in production because local disk is lost on redeploy. ' +
      'Set STORAGE_DRIVER=s3 (with S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, ' +
      'and S3_ENDPOINT for R2), or set ALLOW_LOCAL_STORAGE_IN_PRODUCTION=true on a persistent volume.',
    );
  }
  // Fail at startup, not at first signed URL, if the signing key is unusable
  // (production requires FILE_URL_SECRET of 32+ characters).
  getFileUrlSecret();
  return new LocalStorageDriver();
}

/**
 * The process-wide storage driver, created on first call from env:
 *  - STORAGE_DRIVER=local → LocalStorageDriver (upload dir; signed URLs served
 *    by GET /api/v1/files/signed). Refused in production unless
 *    ALLOW_LOCAL_STORAGE_IN_PRODUCTION=true, and then FILE_URL_SECRET (32+) is required.
 *  - STORAGE_DRIVER=s3 → S3StorageDriver; throws naming any missing env vars.
 * Throws on misconfiguration; a failed call is not cached. fileRoutes calls
 * this at registration, so a bad configuration stops the server from booting.
 */
export function getStorageDriver(): StorageDriver {
  if (!cached) cached = createDriverFromEnv();
  return cached;
}

/** Test hook: forget the memoised driver (call after changing `env` fields). */
export function resetStorageDriverForTests(): void {
  cached = undefined;
}
