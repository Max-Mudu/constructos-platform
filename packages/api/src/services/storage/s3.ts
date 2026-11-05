import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { StorageDriver } from './types';
import { assertValidStorageKey, assertValidTtl, buildContentDisposition } from './signed-url';

/**
 * S3-compatible private object storage (AWS S3, Cloudflare R2, MinIO).
 *
 * For Cloudflare R2: endpoint `https://<account-id>.r2.cloudflarestorage.com`,
 * region `auto`, and (optionally) forcePathStyle. The bucket must be private:
 * no public access, no public r2.dev URL. Encryption at rest is a bucket
 * setting (always on for R2; SSE-S3 default on AWS).
 *
 * Reads by clients never go through the API: `signedUrl` presigns a GetObject
 * locally (no network call) and the browser fetches straight from the bucket.
 */
export interface S3StorageDriverOptions {
  bucket: string;
  region: string;
  /** Omit for AWS S3; required for R2 / MinIO. */
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
  /** Test hook: inject a client (e.g. one whose `send` is stubbed). */
  client?: S3Client;
}

export function createS3Client(opts: Omit<S3StorageDriverOptions, 'bucket' | 'client'>): S3Client {
  return new S3Client({
    region: opts.region,
    ...(opts.endpoint ? { endpoint: opts.endpoint } : {}),
    forcePathStyle: opts.forcePathStyle ?? false,
    credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
    // Only send / validate the newer flexible checksums when an operation
    // requires them: several S3-compatible providers reject or ignore them.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } } | null;
  if (!e) return false;
  return e.name === 'NoSuchKey' || e.name === 'NotFound' || e.Code === 'NoSuchKey'
    || e.$metadata?.httpStatusCode === 404;
}

export class S3StorageDriver implements StorageDriver {
  readonly bucket: string;
  readonly client: S3Client;

  constructor(opts: S3StorageDriverOptions) {
    if (!opts.bucket) throw new Error('S3StorageDriver requires a bucket');
    this.bucket = opts.bucket;
    this.client = opts.client ?? createS3Client(opts);
  }

  async put(key: string, body: Buffer, opts: { contentType: string }): Promise<void> {
    assertValidStorageKey(key);
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: opts.contentType,
      ContentLength: body.length,
      CacheControl: 'private, no-store',
    }));
  }

  async get(key: string): Promise<Buffer | null> {
    assertValidStorageKey(key);
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!res.Body) return null;
      return Buffer.from(await res.Body.transformToByteArray());
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    assertValidStorageKey(key);
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (err) {
      // S3 already returns 204 for a missing key; some compatible stores 404.
      if (isNotFound(err)) return;
      throw err;
    }
  }

  async signedUrl(
    key: string,
    opts: { expiresInSec: number; downloadName?: string; contentType?: string },
  ): Promise<string> {
    assertValidStorageKey(key);
    assertValidTtl(opts.expiresInSec);
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ...(opts.downloadName ? { ResponseContentDisposition: buildContentDisposition(opts.downloadName) } : {}),
      ...(opts.contentType ? { ResponseContentType: opts.contentType } : {}),
    });
    return getSignedUrl(this.client, command, { expiresIn: opts.expiresInSec });
  }
}
