import { UserRole } from '@prisma/client';

export interface JwtPayload {
  sub: string;         // user id
  email: string;
  role: UserRole;
  companyId: string;
  canViewFinance: boolean;
  /** users.sessionVersion when the token was issued (absent on older tokens = 0). */
  sv?: number;
  iat?: number;
  exp?: number;
}

export interface RequestUser {
  id: string;
  email: string;
  role: UserRole;
  companyId: string;
  canViewFinance: boolean;
  /** Session version of the access token (set by middleware/authenticate.ts). */
  sessionVersion?: number;
}

// Augment @fastify/jwt so request.user resolves to RequestUser
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtPayload;
    user: RequestUser;
  }
}
