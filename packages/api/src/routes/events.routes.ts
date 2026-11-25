import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'crypto';
import {
  registerClient,
  unregisterClient,
  formatSSE,
} from '../services/event-emitter.service';
import { JwtPayload } from '../types';
import { env } from '../utils/env';
import { isSessionCurrent } from '../middleware/authenticate';

// Heartbeat interval — keeps the connection alive through proxies and load balancers
const HEARTBEAT_MS = 25_000;

/**
 * One heartbeat of an open stream. The session is checked again first: if it
 * has ended since the stream opened (all sessions ended after a refresh token
 * was reused, a password reset, a deactivation), the stream is closed instead
 * of staying open on an access token that every other route now refuses. A
 * failed check also closes it; the client reconnects and is checked again.
 * Returns false once the stream has been closed.
 */
export async function heartbeatOrClose(
  payload: JwtPayload,
  stream: { write: (data: string) => void; close: () => void },
): Promise<boolean> {
  let current = false;
  try {
    current = await isSessionCurrent(payload);
  } catch {
    current = false;
  }
  if (!current) {
    stream.close();
    return false;
  }
  stream.write(formatSSE('heartbeat', { t: Date.now() }));
  return true;
}

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
   *  invoice_updated      — when an invoice status changes
   *  delivery_created     — when a new delivery is recorded
   *  labour_created       — when a new labour entry is recorded
   *  instruction_updated  — when an instruction is created or updated
   *
   * A record event reaches only users who can read that record through the
   * API at that moment (services/event-emitter.service.ts emitToReaders), and
   * carries record ids only; the client fetches the record itself.
   */
  fastify.get<{ Querystring: { token?: string } }>(
    '/',
    async (request: FastifyRequest<{ Querystring: { token?: string } }>, reply: FastifyReply) => {
      // ── Feature gate ────────────────────────────────────────────────────────
      // SSE_ENABLED (default: on outside production, off in production). The
      // stream authenticates with an access JWT in the query string, so while
      // it is disabled the token is never read or verified. A non-200 makes a
      // browser EventSource close without auto-reconnecting; the web/mobile
      // providers also stop retrying on SSE_DISABLED.
      if (!env.SSE_ENABLED) {
        return reply.status(404).send({ error: 'Live updates are disabled', code: 'SSE_DISABLED' });
      }

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

      // A still-valid JWT can outlive a deactivation or a password reset;
      // the stream applies the same session check as every other route.
      if (!(await isSessionCurrent(payload))) {
        return reply.status(401).send({ error: 'Invalid or expired token', code: 'UNAUTHORIZED' });
      }

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
        session:  payload,
        write: (data: string) => {
          try { reply.raw.write(data); } catch { /* stream gone */ }
        },
      };

      registerClient(client);

      // ── Send connected event ─────────────────────────────────────────────────
      reply.raw.write(formatSSE('connected', { userId, companyId, clientId }));

      // ── Heartbeat (re-checks the session) ───────────────────────────────────
      let ended = false;
      const endStream = () => {
        if (ended) return;
        ended = true;
        clearInterval(heartbeat);
        unregisterClient(client);
        try { reply.raw.end(); } catch { /* stream gone */ }
      };
      const heartbeat = setInterval(() => {
        void heartbeatOrClose(payload, {
          write: (data) => {
            try { reply.raw.write(data); } catch { endStream(); }
          },
          close: endStream,
        });
      }, HEARTBEAT_MS);

      // ── Cleanup on disconnect ────────────────────────────────────────────────
      request.raw.on('close', () => {
        ended = true;
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
      // (or until the server ends the stream after a failed session check)
      await new Promise<void>((resolve) => {
        request.raw.on('close', resolve);
        reply.raw.on('close', resolve);
      });
    },
  );
}
