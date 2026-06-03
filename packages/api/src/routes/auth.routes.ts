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

const updateDefaultsSchema = z.object({
  defaultProjectId: z.string().uuid().nullable(),
  defaultSiteId: z.string().uuid().nullable(),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
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
    try {
      const user = await authService.getMe(request.user.id);
      return reply.send({ user });
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: err.message, code: err.code });
      }
      throw err;
    }
  });

  // POST /api/v1/auth/forgot-password
  fastify.post('/forgot-password', {
    config: {
      rateLimit: { max: 5, timeWindow: 15 * 60 * 1000 },
    },
  }, async (request, reply) => {
    const GENERIC = 'If an account with that email exists, a reset link has been sent.';
    const parsed = forgotPasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.send({ message: GENERIC });
    }
    try {
      const result = await authService.requestPasswordReset(parsed.data.email);
      const response: Record<string, unknown> = { message: GENERIC };
      if (result.devLink) response.devLink = result.devLink;
      return reply.send(response);
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: err.message, code: err.code });
      }
      throw err;
    }
  });

  // POST /api/v1/auth/reset-password
  fastify.post('/reset-password', async (request, reply) => {
    const parsed = resetPasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: parsed.error.flatten().fieldErrors,
      });
    }
    try {
      await authService.resetPassword(parsed.data.token, parsed.data.password);
      return reply.send({ message: 'Password reset successfully. Please sign in with your new password.' });
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: err.message, code: err.code });
      }
      throw err;
    }
  });

  // PATCH /api/v1/auth/me/defaults
  fastify.patch('/me/defaults', { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = updateDefaultsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    try {
      const user = await authService.updateDefaults(
        request.user.id,
        request.user.companyId,
        parsed.data,
      );
      return reply.send({ user });
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: err.message, code: err.code });
      }
      throw err;
    }
  });
}
