/**
 * Access to files uploaded through deliveries, drawing revisions and
 * consultant instructions.
 *
 * The API stores these with `fileUrl: "/uploads/<key>"` and serves them from
 * `GET /uploads/*` on the API origin (NOT under /api/v1). That route requires a
 * Bearer token and re-checks access to the owning record, so a plain
 * `<img src>` / `<a href>` can never load it: `/uploads/...` on the web origin
 * is a Next 404, `/api/v1/uploads/...` is an API 404, and neither sends the
 * token. Files are therefore fetched with the token and handed to the page as
 * a Blob.
 */
import { ApiError } from './api';

/** API origin, as used by the Next rewrite in next.config.js. */
export function apiOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
  return raw.replace(/\/+$/, '');
}

/**
 * Resolves a stored `fileUrl` to the URL that actually serves it.
 * Returns null for anything that is not an API-served `/uploads/` path, so a
 * stored value can never redirect the Bearer token to another host.
 */
export function uploadedFileUrl(fileUrl: string | null | undefined, origin: string = apiOrigin()): string | null {
  if (!fileUrl) return null;
  // Tolerate the previously-used "/api/v1/uploads/..." form.
  const path = fileUrl.startsWith('/api/v1/uploads/') ? fileUrl.slice('/api/v1'.length) : fileUrl;
  if (!path.startsWith('/uploads/')) return null;
  const key = path.slice('/uploads/'.length);
  if (!key || key.split('/').some((seg) => seg === '..' || seg === '.' || seg === '')) return null;
  return `${origin}${path}`;
}

export interface FetchUploadedFileDeps {
  getToken: () => string | null;
  /** Refreshes the session; resolves true when a new access token is available. */
  refresh: () => Promise<boolean>;
  fetchImpl?: typeof fetch;
}

async function errorFrom(res: Response): Promise<ApiError> {
  let body: { error?: string; code?: string } = {};
  try { body = await res.json(); } catch { /* binary or empty body */ }
  if (res.status === 404) {
    return new ApiError(404, body.code ?? 'NOT_FOUND', 'File not found or you no longer have access to it');
  }
  return new ApiError(res.status, body.code ?? 'API_ERROR', body.error ?? 'Could not open the file');
}

/**
 * Fetches an uploaded file with the caller's access token, refreshing the
 * session once on 401. The returned Blob carries `mimeType` when the server
 * sent a generic type (the /uploads route replies application/octet-stream).
 */
export async function fetchUploadedFile(
  fileUrl: string,
  deps: FetchUploadedFileDeps,
  mimeType?: string | null,
): Promise<Blob> {
  const url = uploadedFileUrl(fileUrl);
  if (!url) throw new ApiError(400, 'INVALID_FILE_URL', 'This file link is not valid');
  const doFetch = deps.fetchImpl ?? fetch;

  const attempt = (token: string | null) =>
    doFetch(url, {
      method: 'GET',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: 'omit',
    });

  let res: Response;
  try {
    res = await attempt(deps.getToken());
    if (res.status === 401 && (await deps.refresh())) {
      res = await attempt(deps.getToken());
    }
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server to open the file');
  }

  if (!res.ok) throw await errorFrom(res);

  const blob = await res.blob();
  const generic = !blob.type || blob.type === 'application/octet-stream';
  if (generic && mimeType) return new Blob([blob], { type: mimeType });
  return blob;
}

/** Message shown next to a file that failed to open. */
export function describeFileError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return 'Your session has expired. Sign in again to open this file.';
    return err.message;
  }
  return 'Could not open the file';
}
