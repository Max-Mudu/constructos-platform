/**
 * Daily Site Report V1 — HTTP client.
 *
 * Base: /api/v1/projects/:projectId/sites/:siteId/daily-reports
 *
 * Kept thin on purpose; the decision logic lives in components/daily/*.ts.
 * It differs from lib/api.ts request() in three ways the contract needs:
 *  - per-call timeouts (AI extraction takes 10–40 s; request() aborts at 15 s),
 *  - the whole error body is kept (REVIEW_INCOMPLETE carries `missing`,
 *    REPORT_FINAL carries `reportId`),
 *  - photo upload uses XMLHttpRequest for upload progress.
 * On 401 it lets lib/api.ts refresh the session (authApi.me() goes through
 * the shared, de-duplicated refresh) and retries once with the new token, so
 * there is only ever one refresh-token rotation in flight.
 */
import { ApiError, authApi } from '@/lib/api';
import { getAccessToken, useAuthStore } from '@/store/auth.store';
import type {
  DailyReport,
  DailyReportContentV1,
  DailyReportListQuery,
  DailyReportListResponse,
  DailyReportPhoto,
} from '@/lib/daily-report-types';

const BASE = '/api/v1';

export const TIMEOUTS = {
  default: 20_000,
  extract: 90_000,
  upload: 120_000,
  pdf: 60_000,
} as const;

/** ApiError plus the full JSON error body. */
export class DailyReportApiError extends ApiError {
  constructor(status: number, code: string, message: string, public body: Record<string, unknown> = {}) {
    super(status, code, message);
    this.name = 'DailyReportApiError';
  }
}

export const reportsPath = (projectId: string, siteId: string) =>
  `/projects/${encodeURIComponent(projectId)}/sites/${encodeURIComponent(siteId)}/daily-reports`;
const reportPath = (projectId: string, siteId: string, reportId: string) =>
  `${reportsPath(projectId, siteId)}/${encodeURIComponent(reportId)}`;

async function errorFrom(res: Response): Promise<DailyReportApiError> {
  let body: Record<string, unknown> = {};
  try { body = (await res.json()) as Record<string, unknown>; } catch { /* non-JSON */ }
  const code = typeof body.code === 'string' ? body.code : 'API_ERROR';
  const message = typeof body.error === 'string' ? body.error : 'Request failed';
  return new DailyReportApiError(res.status, code, message, body);
}

/** Lets lib/api.ts refresh the session. Returns false when the session is gone. */
async function refreshSession(): Promise<boolean> {
  try {
    await authApi.me();
    return !!getAccessToken();
  } catch {
    return false;
  }
}

function sessionEnded(): DailyReportApiError {
  useAuthStore.getState().expireSession();
  return new DailyReportApiError(401, 'UNAUTHORIZED', 'Session expired');
}

interface CallOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  json?: unknown;
  timeoutMs?: number;
  signal?: AbortSignal;
}

async function rawFetch(path: string, opts: CallOptions): Promise<Response> {
  const token = getAccessToken();
  const headers: Record<string, string> = { Accept: 'application/json, application/pdf' };
  if (opts.json !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onAbort);
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, opts.timeoutMs ?? TIMEOUTS.default);
  try {
    return await fetch(`${BASE}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.json === undefined ? undefined : JSON.stringify(opts.json),
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') {
      if (timedOut) throw new DailyReportApiError(408, 'TIMEOUT', 'Request timed out');
      throw err; // caller cancelled
    }
    throw new DailyReportApiError(0, 'NETWORK', 'Network error');
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}

async function send(path: string, opts: CallOptions = {}): Promise<Response> {
  let res = await rawFetch(path, opts);
  if (res.status === 401) {
    if (!(await refreshSession())) throw sessionEnded();
    res = await rawFetch(path, opts);
    if (res.status === 401) throw sessionEnded();
  }
  if (!res.ok) throw await errorFrom(res);
  return res;
}

async function call<T>(path: string, opts: CallOptions = {}): Promise<T> {
  const res = await send(path, opts);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export const dailyReportApi = {
  /** 1. GET / — newest reportDate first. */
  list: (projectId: string, siteId: string, q: DailyReportListQuery = {}, signal?: AbortSignal) => {
    const qs = new URLSearchParams();
    if (q.date) qs.set('date', q.date);
    if (q.status) qs.set('status', q.status);
    if (q.cursor) qs.set('cursor', q.cursor);
    if (q.limit) qs.set('limit', String(Math.min(50, Math.max(1, Math.floor(q.limit)))));
    const s = qs.toString();
    return call<DailyReportListResponse>(`${reportsPath(projectId, siteId)}${s ? `?${s}` : ''}`, { signal });
  },

  /**
   * 2. POST / — creates the draft (201) or returns the existing draft (200).
   * An existing final report → 409 REPORT_FINAL with body.reportId.
   */
  createOrOpen: (projectId: string, siteId: string, reportDate: string) =>
    call<{ report: DailyReport }>(reportsPath(projectId, siteId), { method: 'POST', json: { reportDate } }),

  /** 3. GET /:reportId */
  get: (projectId: string, siteId: string, reportId: string, signal?: AbortSignal) =>
    call<{ report: DailyReport }>(reportPath(projectId, siteId, reportId), { signal }),

  /** 4. PATCH /:reportId — draft only; stale → 409 STALE_REPORT. */
  update: (
    projectId: string, siteId: string, reportId: string,
    body: { rawInput?: string; content?: DailyReportContentV1; expectedUpdatedAt: string },
  ) =>
    call<{ report: DailyReport }>(reportPath(projectId, siteId, reportId), { method: 'PATCH', json: body }),

  /** 5. POST /:reportId/extract — uses the saved rawInput; writes only ai* fields. */
  extract: (projectId: string, siteId: string, reportId: string, signal?: AbortSignal) =>
    call<{ report: DailyReport }>(`${reportPath(projectId, siteId, reportId)}/extract`, {
      method: 'POST', json: {}, timeoutMs: TIMEOUTS.extract, signal,
    }),

  /** 7. PATCH /:reportId/photos/:photoId */
  updatePhoto: (projectId: string, siteId: string, reportId: string, photoId: string, body: { caption?: string; sortOrder?: number }) =>
    call<{ photo: DailyReportPhoto }>(`${reportPath(projectId, siteId, reportId)}/photos/${encodeURIComponent(photoId)}`, {
      method: 'PATCH', json: body,
    }),

  /** 8. DELETE /:reportId/photos/:photoId → 204 */
  deletePhoto: (projectId: string, siteId: string, reportId: string, photoId: string) =>
    call<void>(`${reportPath(projectId, siteId, reportId)}/photos/${encodeURIComponent(photoId)}`, { method: 'DELETE' }),

  /** 9. POST /:reportId/finalise — 422 REVIEW_INCOMPLETE carries body.missing. */
  finalise: (projectId: string, siteId: string, reportId: string, expectedUpdatedAt: string) =>
    call<{ report: DailyReport }>(`${reportPath(projectId, siteId, reportId)}/finalise`, {
      method: 'POST', json: { expectedUpdatedAt }, timeoutMs: TIMEOUTS.pdf,
    }),

  /** 10. POST /:reportId/reopen — reason 5..500 chars. */
  reopen: (projectId: string, siteId: string, reportId: string, reason: string, expectedUpdatedAt: string) =>
    call<{ report: DailyReport }>(`${reportPath(projectId, siteId, reportId)}/reopen`, {
      method: 'POST', json: { reason, expectedUpdatedAt },
    }),

  /** 11. GET /:reportId/pdf — bearer fetch → Blob (an <a href> cannot send the token). */
  pdf: async (projectId: string, siteId: string, reportId: string, revision?: number) => {
    const qs = revision === undefined ? '' : `?revision=${encodeURIComponent(String(revision))}`;
    const res = await send(`${reportPath(projectId, siteId, reportId)}/pdf${qs}`, { timeoutMs: TIMEOUTS.pdf });
    const blob = await res.blob();
    return { blob, contentDisposition: res.headers.get('Content-Disposition') };
  },

  /**
   * 6. POST /:reportId/photos — multipart field `file`. Uses XHR so the UI can
   * show upload progress. Retries once after a session refresh on 401.
   */
  uploadPhoto: async (
    projectId: string, siteId: string, reportId: string, file: File,
    onProgress?: (fraction: number) => void,
  ): Promise<{ photo: DailyReportPhoto }> => {
    const url = `${BASE}${reportPath(projectId, siteId, reportId)}/photos`;
    let res = await xhrUpload(url, file, onProgress);
    if (res.status === 401) {
      if (!(await refreshSession())) throw sessionEnded();
      res = await xhrUpload(url, file, onProgress);
      if (res.status === 401) throw sessionEnded();
    }
    if (res.status < 200 || res.status >= 300) {
      const body = res.body;
      throw new DailyReportApiError(
        res.status,
        typeof body.code === 'string' ? body.code : 'API_ERROR',
        typeof body.error === 'string' ? body.error : 'Upload failed',
        body,
      );
    }
    return res.body as unknown as { photo: DailyReportPhoto };
  },
};

function xhrUpload(
  url: string, file: File, onProgress?: (fraction: number) => void,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.withCredentials = true;
    xhr.timeout = TIMEOUTS.upload;
    const token = getAccessToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress?.(Math.min(1, e.loaded / e.total));
    };
    xhr.onload = () => {
      let body: Record<string, unknown> = {};
      try { body = JSON.parse(xhr.responseText || '{}') as Record<string, unknown>; } catch { /* non-JSON */ }
      resolve({ status: xhr.status, body });
    };
    xhr.onerror = () => reject(new DailyReportApiError(0, 'NETWORK', 'Network error'));
    xhr.ontimeout = () => reject(new DailyReportApiError(408, 'TIMEOUT', 'Upload timed out'));
    xhr.onabort = () => reject(new DailyReportApiError(0, 'ABORTED', 'Upload cancelled'));
    const form = new FormData();
    form.append('file', file, file.name);
    xhr.send(form);
  });
}

/** Reads `missing` from a 422 REVIEW_INCOMPLETE error. */
export function missingFromError(err: unknown): unknown {
  return err instanceof DailyReportApiError ? err.body.missing : undefined;
}

/** Reads `reportId` from a 409 REPORT_FINAL error. */
export function reportIdFromError(err: unknown): string | null {
  if (!(err instanceof DailyReportApiError)) return null;
  const id = err.body.reportId;
  return typeof id === 'string' && id ? id : null;
}
