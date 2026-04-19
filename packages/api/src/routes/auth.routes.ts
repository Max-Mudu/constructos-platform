import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as authService from '../services/auth.service';
import { authenticate } from '../middleware/authenticate';
import { AppError } from '../utils/errors';

const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  companyName: z.string().min(2).max(255),
  country: z.string().optional(),
  currency: z.string().length(3).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const logoutSchema = z.object({
  refreshToken: z.string().min(1),
});

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /api/v1/auth/register
  fastify.post('/register', async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    try {
      const result = await authService.register(fastify, parsed.data);
      // Send refresh token as httpOnly cookie
      reply.setCookie('refreshToken', result.tokens.refreshToken, {
        httpOnly: true,
        secure: process.env['NODE_ENV'] === 'production',
        sameSite: 'strict',
        path: '/',
        maxAge: 60 * 60 * 24 * 7, // 7 days
      });
      return reply.status(201).send({
        user:         result.user,
        accessToken:  result.tokens.accessToken,
        refreshToken: result.tokens.refreshToken, // also in body for mobile clients
      });
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: err.message, code: err.code });
      }
      throw err;
    }
  });

  // POST /api/v1/auth/login
  fastify.post('/login', async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    try {
      const result = await authService.login(
        fastify,
        parsed.data,
        request.ip,
        request.headers['user-agent'] ?? null,
      );
      reply.setCookie('refreshToken', result.tokens.refreshToken, {
        httpOnly: true,
        secure: process.env['NODE_ENV'] === 'production',
        sameSite: 'strict',
        path: '/',
        maxAge: 60 * 60 * 24 * 7,
      });
      return reply.send({
        user:         result.user,
        accessToken:  result.tokens.accessToken,
        refreshToken: result.tokens.refreshToken, // also in body for mobile clients
      });
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: err.message, code: err.code });
      }
      throw err;
    }
  });

  // POST /api/v1/auth/refresh
  // Accepts token from httpOnly cookie OR from body (for mobile clients)
  fastify.post('/refresh', async (request, reply) => {
    const cookieToken = request.cookies?.['refreshToken'];
    const bodyParsed = refreshSchema.safeParse(request.body);
    const rawRefreshToken = cookieToken ?? (bodyParsed.success ? bodyParsed.data.refreshToken : null);

    if (!rawRefreshToken) {
      return reply.status(401).send({ error: 'Refresh token required', code: 'UNAUTHORIZED' });
    }

    try {
      const result = await authService.refreshTokens(
        fastify,
        rawRefreshToken,
        request.ip,
        request.headers['user-agent'] ?? null,
      );
      reply.setCookie('refreshToken', result.tokens.refreshToken, {
        httpOnly: true,
        secure: process.env['NODE_ENV'] === 'production',
        sameSite: 'strict',
        path: '/',
        maxAge: 60 * 60 * 24 * 7,
      });
      return reply.send({
        user:         result.user,
        accessToken:  result.tokens.accessToken,
        refreshToken: result.tokens.refreshToken, // also in body for mobile clients
      });
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: err.message, code: err.code });
      }
      throw err;
    }
  });

  // POST /api/v1/auth/logout
  fastify.post('/logout', { preHandler: [authenticate] }, async (request, reply) => {
    const cookieToken = request.cookies?.['refreshToken'];
    const bodyParsed = logoutSchema.safeParse(request.body);
    const rawRefreshToken = cookieToken ?? (bodyParsed.success ? bodyParsed.data.refreshToken : null);

    if (rawRefreshToken) {
      await authService.logout(request.user.id, rawRefreshToken);
    }

    reply.clearCookie('refreshToken', { path: '/' });
    return reply.send({ message: 'Logged out successfully' });
  });

  // GET /api/v1/auth/me
  fastify.get('/me', { preHandler: [authenticate] }, async (request, reply) => {
    return reply.send({ user: request.user });
  });
}
