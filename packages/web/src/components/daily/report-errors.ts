/**
 * Maps API error codes from the Daily Report contract to calm, plain-English
 * messages for a site supervisor. Pure, so it is unit tested.
 */

export interface ErrorView {
  code: string;
  title: string;
  message: string;
  /** Trying the same action again may succeed. */
  retryable: boolean;
  /** An AI drafting failure: offer "Fill in manually". */
  ai: boolean;
}

const AI_CODES = new Set(['AI_DISABLED', 'AI_UNAVAILABLE', 'AI_BUSY', 'AI_NO_DRAFT', 'AI_CAP_REACHED', 'AI_ERROR']);

const VIEWS: Record<string, Omit<ErrorView, 'code'>> = {
  AI_DISABLED: {
    title: 'AI drafting is switched off',
    message: 'AI drafting is not turned on for your company. Your notes are saved — fill in the report yourself.',
    retryable: false, ai: true,
  },
  AI_UNAVAILABLE: {
    title: 'AI assistant not reachable',
    message: 'The AI assistant could not be reached. Your notes are saved. Try again in a few minutes, or fill in the report yourself.',
    retryable: true, ai: true,
  },
  AI_BUSY: {
    title: 'AI assistant is busy',
    message: 'The AI assistant is busy right now. Your notes are saved. Try again in a minute, or fill in the report yourself.',
    retryable: true, ai: true,
  },
  AI_NO_DRAFT: {
    title: 'No draft could be made',
    message: 'The AI could not build a draft from these notes. Add a little more detail and try again, or fill in the report yourself.',
    retryable: true, ai: true,
  },
  AI_CAP_REACHED: {
    title: 'AI limit reached for today',
    message: "Your company's AI drafting limit has been reached. Your notes are saved — fill in the report yourself.",
    retryable: false, ai: true,
  },
  AI_ERROR: {
    title: 'AI drafting failed',
    message: 'Something went wrong while drafting. Your notes are saved. Try again, or fill in the report yourself.',
    retryable: true, ai: true,
  },
  STALE_REPORT: {
    title: 'Updated on another device',
    message: 'This report was changed somewhere else. The latest version has been loaded.',
    retryable: false, ai: false,
  },
  REPORT_FINAL: {
    title: 'Report already finalised',
    message: 'This report has been finalised and can no longer be edited.',
    retryable: false, ai: false,
  },
  REPORT_NOT_FINAL: {
    title: 'Report is not final',
    message: 'This report is still a draft, so it cannot be reopened.',
    retryable: false, ai: false,
  },
  REVIEW_INCOMPLETE: {
    title: 'Some sections still need review',
    message: 'Review every section before finalising. The sections still to review are highlighted.',
    retryable: false, ai: false,
  },
  VALIDATION_ERROR: {
    title: 'Something needs fixing',
    message: 'Some of the information could not be saved. Check the highlighted fields and try again.',
    retryable: false, ai: false,
  },
  FUTURE_DATE: {
    title: 'Date is in the future',
    message: 'A daily report cannot be started for a future date.',
    retryable: false, ai: false,
  },
  NOT_FOUND: {
    title: 'Not found',
    message: 'This report or site could not be found, or you do not have access to it.',
    retryable: false, ai: false,
  },
  FORBIDDEN: {
    title: 'Not allowed',
    message: 'Your role does not allow this action.',
    retryable: false, ai: false,
  },
  UNAUTHORIZED: {
    title: 'Signed out',
    message: 'Your session has ended. Sign in again to continue — your notes are kept on the server.',
    retryable: false, ai: false,
  },
  TIMEOUT: {
    title: 'Taking too long',
    message: 'The request took too long. Check your connection and try again.',
    retryable: true, ai: false,
  },
  NETWORK: {
    title: 'No connection',
    message: 'You appear to be offline. Check your connection and try again.',
    retryable: true, ai: false,
  },
  FILE_TOO_LARGE: {
    title: 'Photo too large',
    message: 'This photo is larger than 10 MB, even after resizing.',
    retryable: false, ai: false,
  },
  UNSUPPORTED_FILE: {
    title: 'Unsupported photo',
    message: 'Only JPEG or PNG photos can be added.',
    retryable: false, ai: false,
  },
  RATE_LIMITED: {
    title: 'Too many requests',
    message: 'Too many requests in a short time. Wait a moment and try again.',
    retryable: true, ai: false,
  },
  SERVICE_UNAVAILABLE: {
    title: 'Service unavailable',
    message: 'The server is not available right now. Try again in a few minutes.',
    retryable: true, ai: false,
  },
  PHOTO_LIMIT: {
    title: 'Photo limit reached',
    message: 'A report can hold up to 30 photos.',
    retryable: false, ai: false,
  },
};

const FALLBACK: Omit<ErrorView, 'code'> = {
  title: 'Something went wrong',
  message: 'Please try again. If it keeps happening, contact your administrator.',
  retryable: true, ai: false,
};

const GENERIC_CODES = new Set(['API_ERROR', 'REQUEST_ERROR', 'INTERNAL_ERROR']);

/** Extracts a code from anything thrown by the daily-report API client. */
export function errorCodeOf(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { code?: unknown; status?: unknown; name?: unknown };
    // Generic codes from the API's global error handler (e.g. a 429 from the
    // rate limiter arrives as REQUEST_ERROR) say nothing specific: use the status.
    if (typeof e.code === 'string' && e.code && !GENERIC_CODES.has(e.code)) return e.code;
    if (typeof e.status === 'number') {
      if (e.status === 401) return 'UNAUTHORIZED';
      if (e.status === 403) return 'FORBIDDEN';
      if (e.status === 404) return 'NOT_FOUND';
      if (e.status === 408) return 'TIMEOUT';
      if (e.status === 413) return 'FILE_TOO_LARGE';
      if (e.status === 415) return 'UNSUPPORTED_FILE';
      if (e.status === 429) return 'RATE_LIMITED';
      if (e.status === 503) return 'SERVICE_UNAVAILABLE';
    }
    if (e.name === 'TypeError') return 'NETWORK';
    if (e.name === 'AbortError') return 'TIMEOUT';
  }
  return 'UNKNOWN';
}

export function describeError(err: unknown, context?: 'extract'): ErrorView {
  const code = errorCodeOf(err);
  const view = VIEWS[code];
  if (view) return { code, ...view };
  if (context === 'extract') return { code, ...VIEWS.AI_ERROR };
  return { code, ...FALLBACK };
}

export function isAiErrorCode(code: string): boolean {
  return AI_CODES.has(code);
}
