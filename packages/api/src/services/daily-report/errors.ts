import { FastifyReply } from 'fastify';
import { AppError, handleError } from '../../utils/errors';

/**
 * A daily report API error: `{ error, code }` plus optional extra fields
 * (e.g. REVIEW_INCOMPLETE `{ missing }`, REPORT_FINAL `{ reportId }`).
 * Messages are fixed strings — never user input or model text.
 */
export class DailyReportError extends AppError {
  constructor(
    statusCode: number,
    code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(statusCode, message, code);
    this.name = 'DailyReportError';
  }
}

/** One generic 404 for every out-of-scope or missing record (no existence oracle). */
export const reportNotFound = () => new DailyReportError(404, 'NOT_FOUND', 'Daily report not found');
export const photoNotFound = () => new DailyReportError(404, 'NOT_FOUND', 'Photo not found');
export const reportFinal = (reportId: string) =>
  new DailyReportError(409, 'REPORT_FINAL', 'Daily report is final', { reportId });
export const reportNotFinal = () => new DailyReportError(409, 'REPORT_NOT_FINAL', 'Daily report is not final');
export const staleReport = () =>
  new DailyReportError(409, 'STALE_REPORT', 'Daily report was changed by someone else; reload and try again');
export const validationError = (message: string, details?: Record<string, unknown>) =>
  new DailyReportError(422, 'VALIDATION_ERROR', message, details);

/**
 * Sends every error from a daily report route. Unexpected errors become a
 * generic 500 here rather than being re-thrown: route plugins registered
 * before app.setErrorHandler() fall back to Fastify's default handler, which
 * echoes error.message — and a Prisma or renderer message may quote notes.
 * Only the error's name and code are logged, for the same reason.
 */
export function sendDailyReportError(err: unknown, reply: FastifyReply): void {
  if (err instanceof DailyReportError) {
    reply.status(err.statusCode).send({ error: err.message, code: err.code, ...(err.details ?? {}) });
    return;
  }
  if (err instanceof AppError) {
    handleError(err, reply);
    return;
  }
  const e = err as { name?: unknown; code?: unknown; statusCode?: unknown } | null;
  const status = typeof e?.statusCode === 'number' && e.statusCode >= 400 && e.statusCode < 500 ? e.statusCode : 500;
  reply.log.error(
    { errName: typeof e?.name === 'string' ? e.name : 'unknown', errCode: typeof e?.code === 'string' ? e.code : undefined },
    'Daily report request failed',
  );
  reply.status(status).send(status === 500
    ? { error: 'Internal server error', code: 'INTERNAL_ERROR' }
    : { error: 'Bad request', code: 'BAD_REQUEST' });
}
