/**
 * Private object storage. Keys are server-generated and tenant-prefixed
 * (e.g. `daily-reports/{companyId}/{reportId}/photos/{uuid}.jpg`); callers must
 * authorise the request before asking for a signed URL.
 */
export interface StorageDriver {
  put(key: string, body: Buffer, opts: { contentType: string }): Promise<void>;
  /** null when the key does not exist. */
  get(key: string): Promise<Buffer | null>;
  /** Idempotent: deleting a missing key is not an error. */
  delete(key: string): Promise<void>;
  /** Short-lived URL for an already-authorised read. */
  signedUrl(key: string, opts: { expiresInSec: number; downloadName?: string; contentType?: string }): Promise<string>;
}

export const SIGNED_URL_TTL_SECONDS = 300;
