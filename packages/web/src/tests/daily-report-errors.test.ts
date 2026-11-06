import { DailyReportApiError } from '@/lib/daily-report-api';
import { describeError, errorCodeOf, isAiErrorCode } from '@/components/daily/report-errors';

jest.mock('@/lib/api', () => {
  class ApiError extends Error {
    constructor(public status: number, public code: string, message: string) { super(message); }
  }
  return { ApiError, authApi: { me: jest.fn() } };
});

const err = (status: number, code: string, body: Record<string, unknown> = {}) => new DailyReportApiError(status, code, code, body);

describe('error-code → message mapping', () => {
  it.each([
    ['AI_DISABLED', 503, false],
    ['AI_UNAVAILABLE', 503, true],
    ['AI_BUSY', 503, true],
    ['AI_NO_DRAFT', 422, true],
    ['AI_CAP_REACHED', 429, false],
  ])('%s is an AI failure with a calm, recoverable message', (code, status, retryable) => {
    const v = describeError(err(status as number, code as string), 'extract');
    expect(v.code).toBe(code);
    expect(v.ai).toBe(true);
    expect(v.retryable).toBe(retryable);
    expect(v.message.length).toBeGreaterThan(20);
    // Never blames the user, never mentions losing work.
    expect(v.message).not.toMatch(/lost|error code|stack|exception/i);
    expect(isAiErrorCode(code as string)).toBe(true);
  });

  it('AI_DISABLED / AI_CAP_REACHED tell the user their notes are saved', () => {
    expect(describeError(err(503, 'AI_DISABLED')).message).toMatch(/notes are saved/i);
    expect(describeError(err(429, 'AI_CAP_REACHED')).message).toMatch(/notes are saved/i);
  });

  it.each([
    ['STALE_REPORT', 409], ['REPORT_FINAL', 409], ['REPORT_NOT_FINAL', 409],
    ['VALIDATION_ERROR', 422], ['REVIEW_INCOMPLETE', 422], ['FUTURE_DATE', 422], ['NOT_FOUND', 404],
  ])('%s maps to its own non-AI message', (code, status) => {
    const v = describeError(err(status as number, code as string));
    expect(v.code).toBe(code);
    expect(v.ai).toBe(false);
    expect(v.title).not.toBe('Something went wrong');
  });

  it('falls back on HTTP status when the body has no code', () => {
    expect(errorCodeOf(err(401, 'API_ERROR'))).toBe('UNAUTHORIZED');
    expect(errorCodeOf(err(403, 'API_ERROR'))).toBe('FORBIDDEN');
    expect(errorCodeOf(err(404, 'API_ERROR'))).toBe('NOT_FOUND');
    expect(errorCodeOf(err(408, 'TIMEOUT'))).toBe('TIMEOUT');
    expect(errorCodeOf(err(503, 'API_ERROR'))).toBe('SERVICE_UNAVAILABLE');
    expect(errorCodeOf(new TypeError('Failed to fetch'))).toBe('NETWORK');
    expect(errorCodeOf(null)).toBe('UNKNOWN');
  });

  it('an unknown extraction failure still gets the AI fallback (offer Fill in manually)', () => {
    const v = describeError(err(500, 'API_ERROR'), 'extract');
    expect(v.ai).toBe(true);
    expect(v.retryable).toBe(true);
    const generic = describeError(err(500, 'API_ERROR'));
    expect(generic.ai).toBe(false);
    expect(generic.title).toBe('Something went wrong');
  });
});

describe('generic server codes fall back to the HTTP status', () => {
  it('a rate-limited request (429 REQUEST_ERROR from the API rate limiter) reads as "Too many requests"', () => {
    expect(errorCodeOf(err(429, 'REQUEST_ERROR'))).toBe('RATE_LIMITED');
    const view = describeError(err(429, 'REQUEST_ERROR'), 'extract');
    expect(view.title).toBe('Too many requests');
    expect(view.retryable).toBe(true);
  });

  it('other generic codes use the status mapping too (503, 404)', () => {
    expect(errorCodeOf(err(503, 'REQUEST_ERROR'))).toBe('SERVICE_UNAVAILABLE');
    expect(errorCodeOf(err(404, 'REQUEST_ERROR'))).toBe('NOT_FOUND');
    expect(errorCodeOf(err(500, 'INTERNAL_ERROR'))).toBe('UNKNOWN');
  });

  it('specific codes still win over the status', () => {
    expect(errorCodeOf(err(429, 'AI_CAP_REACHED'))).toBe('AI_CAP_REACHED');
    expect(errorCodeOf(err(409, 'STALE_REPORT'))).toBe('STALE_REPORT');
  });
});
