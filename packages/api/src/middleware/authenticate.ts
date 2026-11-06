import { FastifyRequest, FastifyReply } from 'fastify';
import { UnauthorizedError } from '../utils/errors';
import { prisma } from '../utils/prisma';
import { JwtPayload } from '../types';

function sendUnauthorized(reply: FastifyReply): void {
  const error = new UnauthorizedError('Invalid or expired token');
  reply.status(401).send({ error: error.message, code: error.code });
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

  // A valid access token outlives a deactivation by up to JWT_EXPIRES_IN
  // (default 15 min). Refuse it as soon as the account is inactive, deleted
  // or no longer in the token's company. Ids are checked to be strings first:
  // an undefined id in a Prisma where clause would match any row.
  if (typeof payload.sub !== 'string' || typeof payload.companyId !== 'string') {
    sendUnauthorized(reply);
    return;
  }
  const active = await prisma.user.findFirst({
    where:  { id: payload.sub, companyId: payload.companyId, isActive: true },
    select: { id: true },
  });
  if (!active) {
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
