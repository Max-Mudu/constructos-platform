import 'dotenv/config';
import path from 'path';
import Fastify, { FastifyServerOptions } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyMultipart from '@fastify/multipart';
import { env } from './utils/env';
import { authenticate } from './middleware/authenticate';
import { authRoutes } from './routes/auth.routes';
import { companyRoutes } from './routes/company.routes';
import { projectRoutes } from './routes/project.routes';
import { jobsiteRoutes } from './routes/jobsite.routes';
import { memberRoutes } from './routes/member.routes';
import { deliveryRoutes } from './routes/delivery.routes';
import { inventoryRoutes } from './routes/inventory.routes';
import { supplierRoutes } from './routes/supplier.routes';
import { workerRoutes, siteWorkerRoutes } from './routes/worker.routes';
import { labourRoutes } from './routes/labour.routes';
import { attendanceRoutes } from './routes/attendance.routes';
import { targetsRoutes } from './routes/targets.routes';
import { contractorRoutes } from './routes/contractor.routes';
import { scheduleRoutes } from './routes/schedule.routes';
import { drawingRoutes } from './routes/drawing.routes';
import { instructionRoutes } from './routes/instruction.routes';
import { budgetRoutes } from './routes/budget.routes';
import { invoiceRoutes } from './routes/invoice.routes';
import { notificationRoutes } from './routes/notification.routes';
import { dashboardRoutes } from './routes/dashboard.routes';
import { reportRoutes } from './routes/report.routes';
import { eventsRoutes } from './routes/events.routes';
import { activityRoutes } from './routes/activity.routes';
import { mobileRoutes } from './routes/mobile.routes';
import { dailyReportRoutes } from './routes/daily-report.routes';
import { fileRoutes } from './routes/files.routes';
import { prisma } from './utils/prisma';
import { canAccessUploadedFile } from './services/file-access.service';
import { legacyLocalUploadDriver, legacyUploadRoot, readFile as readUploadedFile } from './services/upload.service';
import { StorageDriver } from './services/storage/types';
import { getStorageDriver } from './services/storage';
import { ReportExtractor } from './services/daily-report/extractor/types';
import { getReportExtractor } from './services/daily-report/extractor';
import { RenderDailyReportPdf } from './services/daily-report/pdf/types';
import { renderDailyReportPdf } from './services/daily-report/pdf/renderer';

declare module 'fastify' {
  interface FastifyInstance {
    /** Storage for delivery, drawing and instruction uploads (see buildApp). */
    uploadStorage: StorageDriver;
  }
}

/**
 * Returns the path part of a URL — no query string, no fragment.
 *
 * GET /api/v1/events carries the access JWT as ?token= (EventSource cannot
 * send headers), so a URL with its query string must never be logged.
 */
export function stripQueryString(url: string | undefined): string | undefined {
  if (typeof url !== 'string') return url;
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

interface LoggableRequest {
  method?:   string;
  url?:      string;
  hostname?: string;
  ip?:       string;
  socket?:   { remotePort?: number };
}

/**
 * Pino options shared by the app logger.
 *  - serializers.req replaces Fastify's default (which logs the full URL).
 *  - formatters.log strips the query from any top-level `url` field, which
 *    covers explicit `{ url: request.url }` log calls such as the JWT-failure
 *    warning in middleware/authenticate.ts.
 */
export const loggerOptions = {
  serializers: {
    req(req: LoggableRequest) {
      return {
        method:        req.method,
        url:           stripQueryString(req.url),
        hostname:      req.hostname,
        remoteAddress: req.ip,
        remotePort:    req.socket ? req.socket.remotePort : undefined,
      };
    },
  },
  formatters: {
    log(obj: Record<string, unknown>) {
      return typeof obj['url'] === 'string'
        ? { ...obj, url: stripQueryString(obj['url']) }
        : obj;
    },
  },
};

export interface BuildAppOptions {
  /** Test hook: send logs to this stream (enables logging even under test). */
  logStream?: NodeJS.WritableStream;
  /** Test hook: private object storage (default: getStorageDriver()). */
  storage?: StorageDriver;
  /**
   * Test hook: storage for delivery, drawing and instruction uploads.
   * Default: STORAGE_DRIVER=s3 → the same driver as `storage`;
   * STORAGE_DRIVER=local → local disk under the legacy uploads directory.
   */
  uploadStorage?: StorageDriver;
  /** Test hook: daily report AI extractor (default: getReportExtractor()). */
  reportExtractor?: ReportExtractor;
  /** Test hook: daily report PDF renderer (default: renderDailyReportPdf). */
  renderPdf?: RenderDailyReportPdf;
}

export async function buildApp(options: BuildAppOptions = {}) {
  const logger: FastifyServerOptions['logger'] = options.logStream
    ? { ...loggerOptions, stream: options.logStream }
    : env.isTest ? false : loggerOptions;

  const app = Fastify({
    logger,
    // TRUST_PROXY (default false): only trust X-Forwarded-* from the proxies
    // explicitly configured for this deployment. request.ip feeds rate
    // limiting and audit logs, so unrestricted trust lets any client spoof it.
    trustProxy: env.TRUST_PROXY,
  });

  // ── Security headers ─────────────────────────────────────────────────────
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: env.isProduction,
  });

  // ── CORS ─────────────────────────────────────────────────────────────────
  await app.register(fastifyCors, {
    origin: env.CORS_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // ── Rate limiting ─────────────────────────────────────────────────────────
  // Skipped in test: all inject() calls share the same IP so the in-memory
  // counter is never reset between tests, causing spurious 429s.
  if (!env.isTest) {
    await app.register(fastifyRateLimit, {
      max: 100,
      timeWindow: '1 minute',
      keyGenerator: (req) => req.ip,
    });
  }

  // ── Multipart (file uploads) ──────────────────────────────────────────────
  // Framework-level cap prevents large payloads from being buffered before the
  // upload service can check size. upload.service.ts enforces its own 20 MB
  // limit with a better error message; 25 MB here is the hard ceiling.
  await app.register(fastifyMultipart, {
    limits: { fileSize: 25 * 1024 * 1024 },
  });

  // ── Cookies ──────────────────────────────────────────────────────────────
  await app.register(fastifyCookie);

  // ── JWT ──────────────────────────────────────────────────────────────────
  await app.register(fastifyJwt, {
    secret: env.JWT_SECRET,
  });

  // ── Daily report dependencies ────────────────────────────────────────────
  // Resolved lazily on first use, so a misconfigured driver only fails the
  // routes that need it and test suites that never touch them are unaffected.
  let storage = options.storage;
  let reportExtractor = options.reportExtractor;
  app.decorate('storage', {
    getter: () => (storage ??= getStorageDriver()),
  });
  // Delivery, drawing and instruction uploads. With STORAGE_DRIVER=local they
  // stay on local disk exactly as before (including in production, where the
  // Daily Report guard does not apply to them); with s3 they share the bucket.
  let uploadStorage = options.uploadStorage;
  app.decorate('uploadStorage', {
    getter: () => (uploadStorage ??= env.STORAGE_DRIVER === 's3' ? app.storage : legacyLocalUploadDriver()),
  });
  app.decorate('reportExtractor', {
    getter: () => (reportExtractor ??= getReportExtractor()),
  });
  app.decorate('renderPdf', options.renderPdf ?? renderDailyReportPdf);

  // ── Global error handler ─────────────────────────────────────────────────
  // Set before any route plugin is registered: Fastify copies the parent's
  // error handler into each plugin context at registration time, so a handler
  // set afterwards would leave every route on the default handler, which
  // echoes internal error messages on a 500.
  app.setErrorHandler((error, request, reply) => {
    app.log.error({
      err:    error,
      method: request.method,
      url:    stripQueryString(request.url), // never log ?token= (SSE)
      userId: (request.user as { id?: string } | null | undefined)?.id,
    }, 'Unhandled server error');
    const statusCode = error.statusCode ?? 500;
    reply.status(statusCode).send({
      error: statusCode >= 500 ? 'Internal server error' : error.message,
      code: statusCode >= 500 ? 'INTERNAL_ERROR' : (error.code ?? 'REQUEST_ERROR'),
    });
  });

  // ── Routes ───────────────────────────────────────────────────────────────
  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(fileRoutes, { prefix: '/api/v1/files' });
  await app.register(companyRoutes, { prefix: '/api/v1/companies' });
  await app.register(projectRoutes, { prefix: '/api/v1/projects' });
  await app.register(jobsiteRoutes, { prefix: '/api/v1/projects/:projectId/sites' });
  await app.register(memberRoutes, { prefix: '/api/v1/projects/:projectId/members' });
  await app.register(deliveryRoutes,   { prefix: '/api/v1/projects/:projectId/sites/:siteId/deliveries' });
  await app.register(inventoryRoutes,  { prefix: '/api/v1/projects/:projectId/sites/:siteId/inventory' });
  await app.register(supplierRoutes, { prefix: '/api/v1/suppliers' });
  await app.register(workerRoutes,   { prefix: '/api/v1/workers' });
  await app.register(siteWorkerRoutes, { prefix: '/api/v1/projects/:projectId/sites/:siteId/workers' });
  await app.register(labourRoutes,      { prefix: '/api/v1/projects/:projectId/sites/:siteId/labour' });
  await app.register(attendanceRoutes,  { prefix: '/api/v1/projects/:projectId/sites/:siteId/attendance' });
  await app.register(targetsRoutes,     { prefix: '/api/v1/projects/:projectId/sites/:siteId/targets' });
  await app.register(contractorRoutes,  { prefix: '/api/v1/contractors' });
  await app.register(scheduleRoutes,    { prefix: '/api/v1/projects/:projectId/sites/:siteId/schedule' });
  await app.register(drawingRoutes,     { prefix: '/api/v1/projects/:projectId/drawings' });
  await app.register(instructionRoutes, { prefix: '/api/v1/projects/:projectId/instructions' });
  await app.register(budgetRoutes,      { prefix: '/api/v1/budgets' });
  await app.register(invoiceRoutes,         { prefix: '/api/v1/invoices' });
  await app.register(notificationRoutes,    { prefix: '/api/v1/notifications' });
  await app.register(dashboardRoutes,       { prefix: '/api/v1/dashboard' });
  await app.register(reportRoutes,          { prefix: '/api/v1/reports' });
  await app.register(eventsRoutes,          { prefix: '/api/v1/events' });
  await app.register(activityRoutes,        { prefix: '/api/v1/activity' });
  await app.register(mobileRoutes,          { prefix: '/api/v1' });
  await app.register(dailyReportRoutes,     { prefix: '/api/v1/projects/:projectId/sites/:siteId/daily-reports' });

  // ── Serve uploaded files ──────────────────────────────────────────────────
  // Requires authentication plus the same company, role, project-membership,
  // site and contractor rules as the record that owns the file (see
  // services/file-access.service.ts). Every denial is a 404 so a caller cannot
  // probe for keys that exist. Bytes come from the upload storage driver
  // (local disk or bucket), falling back to the legacy local directory.
  app.get(
    '/uploads/*',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const relativePath = (request.params as Record<string, string>)['*'];

      // ── Path-traversal guard ─────────────────────────────────────────────
      const uploadRoot = legacyUploadRoot();
      const filePath   = path.resolve(uploadRoot, relativePath);
      if (!filePath.startsWith(uploadRoot + path.sep)) {
        return reply.status(400).send({ error: 'Invalid file path', code: 'INVALID_PATH' });
      }

      // ── Record-level authorisation ───────────────────────────────────────
      // The fileKey (= relativePath) must belong to a record in the caller's
      // company that the caller is allowed to view.
      if (!(await canAccessUploadedFile(relativePath, request.user))) {
        return reply.status(404).send({ error: 'File not found', code: 'NOT_FOUND' });
      }

      const buffer = await readUploadedFile(relativePath, app.uploadStorage);
      if (!buffer) {
        return reply.status(404).send({ error: 'File not found', code: 'NOT_FOUND' });
      }
      return reply.send(buffer);
    },
  );

  // ── Health check ─────────────────────────────────────────────────────────
  app.get('/health', async (_req, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return reply.send({ status: 'ok', timestamp: new Date().toISOString() });
    } catch {
      return reply.status(503).send({ status: 'error', timestamp: new Date().toISOString() });
    }
  });

  // ── Not-found handler ────────────────────────────────────────────────────
  // Fastify's default 404 logs and echoes the raw URL, query string included.
  app.setNotFoundHandler((request, reply) => {
    request.log.info({ method: request.method, url: stripQueryString(request.url) }, 'Route not found');
    return reply.status(404).send({ error: 'Route not found', code: 'NOT_FOUND' });
  });

  return app;
}

async function start() {
  const app = await buildApp();
  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
    console.log(`API server running on port ${env.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// Only start the server if this file is run directly
if (require.main === module) {
  start();
}
