import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'crypto';
import {
  registerClient,
  unregisterClient,
  formatSSE,
} from '../services/event-emitter.service';
import { JwtPayload } from '../types';
import { env } from '../utils/env';

// Heartbeat interval — keeps the connection alive through proxies and load balancers
const HEARTBEAT_MS = 25_000;

export async function eventsRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/events?token=<jwt>
   *
   * Server-Sent Events stream.  The token is passed as a query param because
   * the browser's native EventSource API does not support custom headers.
   *
   * Events emitted:
   *  connected            — immediately on open
   *  heartbeat            — every 25 s
   *  notification         — when a new in-app notification is created for the user
   *  dashboard            — when any significant company-wide data changes
   *  invoice_updated      — when an invoice status changes
   *  delivery_created     — when a new delivery is recorded
   *  labour_created       — when a new labour entry is recorded
   *  instruction_updated  — when an instruction is created or updated
   */
  fastify.get<{ Querystring: { token?: string } }>(
    '/',
    async (request: FastifyRequest<{ Querystring: { token?: string } }>, reply: FastifyReply) => {
      const { token } = request.query;

      // ── Authenticate ────────────────────────────────────────────────────────
      if (!token) {
        return reply.status(401).send({ error: 'Missing token', code: 'UNAUTHORIZED' });
      }

      let payload: JwtPayload;
      try {
        payload = fastify.jwt.verify<JwtPayload>(token);
      } catch {
        return reply.status(401).send({ error: 'Invalid or expired token', code: 'UNAUTHORIZED' });
      }

      const userId    = payload.sub;
      const companyId = payload.companyId;

      // ── SSE headers ─────────────────────────────────────────────────────────
      reply.raw.writeHead(200, {
        'Content-Type':  'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection':    'keep-alive',
        'X-Accel-Buffering': 'no',   // disable Nginx buffering
      });
      reply.raw.flushHeaders?.();

      // ── Register client ──────────────────────────────────────────────────────
      const clientId = randomUUID();
      const client = {
        id:       clientId,
        userId,
        companyId,
        write: (data: string) => {
          try { reply.raw.write(data); } catch { /* stream gone */ }
        },
      };

      registerClient(client);

      // ── Send connected event ─────────────────────────────────────────────────
      reply.raw.write(formatSSE('connected', { userId, companyId, clientId }));

      // ── Heartbeat ────────────────────────────────────────────────────────────
      const heartbeat = setInterval(() => {
        try {
          reply.raw.write(formatSSE('heartbeat', { t: Date.now() }));
        } catch {
          clearInterval(heartbeat);
        }
      }, HEARTBEAT_MS);

      // ── Cleanup on disconnect ────────────────────────────────────────────────
      request.raw.on('close', () => {
        clearInterval(heartbeat);
        unregisterClient(client);
      });

      // In test mode, close immediately after writing the connected event so
      // that Fastify inject() can complete without hanging.
      if (env.isTest) {
        reply.raw.end();
        return;
      }

      // Keep the response open — do not return / call reply.send()
      await new Promise<void>((resolve) => {
        request.raw.on('close', resolve);
      });
    },
  );
}
