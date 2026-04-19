import { UserRole } from '@prisma/client';

export interface JwtPayload {
  sub: string;         // user id
  email: string;
  role: UserRole;
  companyId: string;
  canViewFinance: boolean;
  iat?: number;
  exp?: number;
}

export interface RequestUser {
  id: string;
  email: string;
  role: UserRole;
  companyId: string;
  canViewFinance: boolean;
}

// Augment @fastify/jwt so request.user resolves to RequestUser
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtPayload;
    user: RequestUser;
  }
}
