import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate';
import * as notificationService from '../services/notification.service';
import * as pushService from '../services/push.service';
import { handleError } from '../utils/errors';

// ─── Schemas ──────────────────────────────────────────────────────────────────

const pushTokenSchema = z.object({
  token:    z.string().min(1).max(512),
  platform: z.enum(['ios', 'android', 'expo']),
});

const preferenceUpdateSchema = z.object({
  preferences: z.array(
    z.object({
      type:    z.string().min(1),
      enabled: z.boolean(),
    }),
  ).min(1),
});

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function notificationRoutes(fastify: FastifyInstance): Promise<void> {

  // POST /notifications/push-token  — register a push token
  fastify.post(
    '/push-token',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const parsed = pushTokenSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          error: 'Validation failed', code: 'VALIDATION_ERROR',
          details: parsed.error.flatten().fieldErrors,
        });
      }
      try {
        await pushService.registerPushToken(
          request.user.id,
          request.user.companyId,
          parsed.data.token,
          parsed.data.platform,
        );
        return reply.status(204).send();
      } catch (err) { return handleError(err, reply); }
    },
  );

  // DELETE /notifications/push-token/:token  — unregister a push token
  fastify.delete(
    '/push-token/:token',
    { preHandler: [authenticate] },
    async (request, reply) => {
      try {
        const { token } = request.params as { token: string };
        await pushService.unregisterPushToken(token, request.user.id);
        return reply.status(204).send();
      } catch (err) { return handleError(err, reply); }
    },
  );

  // GET /notifications/count   — unread count (fast — called on every page load)
  fastify.get(
    '/count',
    { preHandler: [authenticate] },
    async (request, reply) => {
      try {
        const count = await notificationService.getUnreadCount(request.user);
        return reply.send({ count });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // GET /notifications
  fastify.get(
    '/',
    { preHandler: [authenticate] },
    async (request, reply) => {
      try {
        const q = request.query as Record<string, string>;
        const isRead  = q['isRead']  !== undefined ? q['isRead'] === 'true' : undefined;
        const type    = q['type']    || undefined;
        const limit   = q['limit']  ? Math.min(Number(q['limit']),  100) : 50;
        const offset  = q['offset'] ? Math.max(Number(q['offset']),   0) : 0;

        const result = await notificationService.listNotifications(request.user, {
          isRead, type, limit, offset,
        });
        return reply.send(result);
      } catch (err) { return handleError(err, reply); }
    },
  );

  // POST /notifications/read-all
  fastify.post(
    '/read-all',
    { preHandler: [authenticate] },
    async (request, reply) => {
      try {
        const result = await notificationService.markAllRead(request.user);
        return reply.send(result);
      } catch (err) { return handleError(err, reply); }
    },
  );

  // POST /notifications/:notificationId/read
  fastify.post(
    '/:notificationId/read',
    { preHandler: [authenticate] },
    async (request, reply) => {
      try {
        const { notificationId } = request.params as { notificationId: string };
        const notification = await notificationService.markRead(notificationId, request.user);
        return reply.send({ notification });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // DELETE /notifications/:notificationId
  fastify.delete(
    '/:notificationId',
    { preHandler: [authenticate] },
    async (request, reply) => {
      try {
        const { notificationId } = request.params as { notificationId: string };
        await notificationService.deleteNotification(notificationId, request.user);
        return reply.status(204).send();
      } catch (err) { return handleError(err, reply); }
    },
  );

  // GET /notifications/preferences
  fastify.get(
    '/preferences',
    { preHandler: [authenticate] },
    async (request, reply) => {
      try {
        const preferences = await notificationService.getPreferences(request.user);
        return reply.send({ preferences });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // PUT /notifications/preferences
  fastify.put(
    '/preferences',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const parsed = preferenceUpdateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          error: 'Validation failed', code: 'VALIDATION_ERROR',
          details: parsed.error.flatten().fieldErrors,
        });
      }
      try {
        const preferences = await notificationService.upsertPreferences(
          request.user,
          parsed.data.preferences,
        );
        return reply.send({ preferences });
      } catch (err) { return handleError(err, reply); }
    },
  );
}
