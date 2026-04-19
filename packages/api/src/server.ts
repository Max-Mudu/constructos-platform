import 'dotenv/config';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import Fastify from 'fastify';
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
import { prisma } from './utils/prisma';

export async function buildApp() {
  const app = Fastify({
    logger: !env.isTest,
    trustProxy: true,
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
  await app.register(fastifyRateLimit, {
    max: 100,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.ip,
  });

  // ── Multipart (file uploads) ──────────────────────────────────────────────
  await app.register(fastifyMultipart);

  // ── Cookies ──────────────────────────────────────────────────────────────
  await app.register(fastifyCookie);

  // ── JWT ──────────────────────────────────────────────────────────────────
  await app.register(fastifyJwt, {
    secret: env.JWT_SECRET,
  });

  // ── Routes ───────────────────────────────────────────────────────────────
  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(companyRoutes, { prefix: '/api/v1/companies' });
  await app.register(projectRoutes, { prefix: '/api/v1/projects' });
  await app.register(jobsiteRoutes, { prefix: '/api/v1/projects/:projectId/sites' });
  await app.register(memberRoutes, { prefix: '/api/v1/projects/:projectId/members' });
  await app.register(deliveryRoutes, { prefix: '/api/v1/projects/:projectId/sites/:siteId/deliveries' });
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

  // ── Serve uploaded files ──────────────────────────────────────────────────
  // Requires authentication and tenant-scoped ownership check.
  // In production replace with CDN / S3 pre-signed URLs.
  app.get(
    '/uploads/*',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const uploadDir = env.isTest
        ? path.join(os.tmpdir(), 'construction-platform-test-uploads')
        : path.resolve(process.cwd(), 'uploads');

      const relativePath = (request.params as Record<string, string>)['*'];

      // ── Path-traversal guard ─────────────────────────────────────────────
      const uploadRoot = path.resolve(uploadDir);
      const filePath   = path.resolve(uploadDir, relativePath);
      if (!filePath.startsWith(uploadRoot + path.sep)) {
        return reply.status(400).send({ error: 'Invalid file path', code: 'INVALID_PATH' });
      }

      // ── Tenant-scoped ownership check ────────────────────────────────────
      // Look up the fileKey (= relativePath) in the DB and ensure it belongs
      // to the authenticated user's company. This also prevents enumeration.
      const companyId = request.user.companyId;
      const [photo, document, drawingRevision, instructionAttachment] = await Promise.all([
        prisma.deliveryPhoto.findFirst({
          where: { fileKey: relativePath, companyId },
          select: { id: true },
        }),
        prisma.deliveryDocument.findFirst({
          where: { fileKey: relativePath, companyId },
          select: { id: true },
        }),
        prisma.drawingRevision.findFirst({
          where: { fileKey: relativePath, companyId },
          select: { id: true },
        }),
        prisma.instructionAttachment.findFirst({
          where: { fileKey: relativePath, companyId },
          select: { id: true },
        }),
      ]);

      if (!photo && !document && !drawingRevision && !instructionAttachment) {
        return reply.status(404).send({ error: 'File not found', code: 'NOT_FOUND' });
      }

      try {
        const buffer = await fs.readFile(filePath);
        return reply.send(buffer);
      } catch {
        return reply.status(404).send({ error: 'File not found', code: 'NOT_FOUND' });
      }
    },
  );

  // ── Health check ─────────────────────────────────────────────────────────
  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  // ── Global error handler ─────────────────────────────────────────────────
  app.setErrorHandler((error, request, reply) => {
    app.log.error(error);
    const statusCode = error.statusCode ?? 500;
    reply.status(statusCode).send({
      error: statusCode === 500 ? 'Internal server error' : error.message,
      code: 'INTERNAL_ERROR',
    });
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
