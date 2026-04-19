export class AppError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public code?: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(401, message, 'UNAUTHORIZED');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(403, message, 'FORBIDDEN');
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(404, `${resource} not found`, 'NOT_FOUND');
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, message, 'CONFLICT');
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(422, message, 'VALIDATION_ERROR');
  }
}

/**
 * Shared route error handler. Re-throws unknown errors so Fastify's global
 * handler can log them; sends a structured response for AppError subclasses.
 */
export function handleError(err: unknown, reply: import('fastify').FastifyReply): void {
  if (err instanceof AppError) {
    reply.status(err.statusCode).send({ error: err.message, code: err.code });
    return;
  }
  throw err;
}
