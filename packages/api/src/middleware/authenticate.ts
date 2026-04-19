import { FastifyRequest, FastifyReply } from 'fastify';
import { UnauthorizedError } from '../utils/errors';
import { JwtPayload } from '../types';

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  try {
    // jwtVerify decodes the token and sets request.user via the FastifyJWT augmentation.
    // We decode manually so we can map `sub` → `id`.
    const payload = await request.jwtVerify<JwtPayload>();
    // @fastify/jwt sets request.user to the raw payload; we remap sub → id
    (request as FastifyRequest & { user: unknown }).user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      companyId: payload.companyId,
      canViewFinance: payload.canViewFinance,
    };
  } catch {
    const error = new UnauthorizedError('Invalid or expired token');
    reply.status(401).send({ error: error.message, code: error.code });
  }
}
