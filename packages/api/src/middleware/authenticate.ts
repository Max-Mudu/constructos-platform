import { FastifyRequest, FastifyReply } from 'fastify';
import { UnauthorizedError } from '../utils/errors';
import { prisma } from '../utils/prisma';
import { JwtPayload, RequestUser } from '../types';

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

/**
 * The user a long-lived connection (the live-updates stream) acts as right
 * now, or null when the access token it opened with has expired or
 * isSessionCurrent would refuse it. Role and finance permission are read from
 * the user row, not from the token, so a change made while the stream is open
 * applies to the next event.
 */
export async function currentUserForSession(
  payload: JwtPayload,
  now: number = Date.now(),
): Promise<RequestUser | null> {
  if (typeof payload.exp === 'number' && payload.exp * 1000 <= now) return null;
  if (typeof payload.sub !== 'string' || typeof payload.companyId !== 'string') return null;
  const tokenVersion = payload.sv === undefined ? 0 : payload.sv;
  if (!Number.isSafeInteger(tokenVersion)) return null;
  const row = await prisma.user.findFirst({
    where:  { id: payload.sub, companyId: payload.companyId, isActive: true, sessionVersion: tokenVersion },
    select: { id: true, email: true, role: true, companyId: true, canViewFinance: true },
  });
  return row === null ? null : { ...row, sessionVersion: tokenVersion };
}

/**
 * The request user for a verified access-token payload (sub → id). Shared by
 * this middleware and the live-updates stream, so both act as the same user.
 */
export function requestUserFromPayload(payload: JwtPayload): RequestUser {
  return {
    id: payload.sub,
    email: payload.email,
    role: payload.role,
    companyId: payload.companyId,
    canViewFinance: payload.canViewFinance,
    sessionVersion: payload.sv === undefined ? 0 : payload.sv,
  };
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
  (request as FastifyRequest & { user: unknown }).user = requestUserFromPayload(payload);
}
