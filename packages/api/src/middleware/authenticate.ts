import { FastifyRequest, FastifyReply } from 'fastify';
import { UnauthorizedError } from '../utils/errors';
import { prisma } from '../utils/prisma';
import { JwtPayload } from '../types';

function sendUnauthorized(reply: FastifyReply): void {
  const error = new UnauthorizedError('Invalid or expired token');
  reply.status(401).send({ error: error.message, code: error.code });
}

/**
 * True when a verified access-token payload still belongs to a live session:
 * the user exists, is active, is in the token's company, and the token's
 * session version (`sv`) equals users.sessionVersion. Shared by every route
 * that accepts an access token (this middleware and the live-updates stream).
 *
 * A valid access token outlives a deactivation by up to JWT_EXPIRES_IN
 * (default 15 min), so this is checked on every request. Ids are checked to
 * be strings first: an undefined id in a Prisma where clause would match any
 * row. Tokens signed before `sv` existed carry none and count as version 0; a
 * token from before the user's sessions were last invalidated never becomes
 * valid again, even if the account is reactivated while it is unexpired.
 */
export async function isSessionCurrent(payload: JwtPayload): Promise<boolean> {
  if (typeof payload.sub !== 'string' || typeof payload.companyId !== 'string') {
    return false;
  }
  const tokenVersion = payload.sv === undefined ? 0 : payload.sv;
  if (!Number.isSafeInteger(tokenVersion)) return false;
  const active = await prisma.user.findFirst({
    where:  { id: payload.sub, companyId: payload.companyId, isActive: true, sessionVersion: tokenVersion },
    select: { id: true },
  });
  return active !== null;
}

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  let payload: JwtPayload;
  try {
    // jwtVerify decodes the token and sets request.user via the FastifyJWT augmentation.
    // We decode manually so we can map `sub` → `id`.
    payload = await request.jwtVerify<JwtPayload>();
  } catch {
    request.log.warn({ method: request.method, url: request.url }, 'JWT verification failed');
    sendUnauthorized(reply);
    return;
  }

  if (!(await isSessionCurrent(payload))) {
    request.log.warn({ method: request.method, url: request.url }, 'Token for inactive or unknown user');
    sendUnauthorized(reply);
    return;
  }

  // @fastify/jwt sets request.user to the raw payload; we remap sub → id
  (request as FastifyRequest & { user: unknown }).user = {
    id: payload.sub,
    email: payload.email,
    role: payload.role,
    companyId: payload.companyId,
    canViewFinance: payload.canViewFinance,
  };
}
