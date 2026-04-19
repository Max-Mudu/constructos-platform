import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AttendanceStatus } from '@prisma/client';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import { requireProjectAccess } from '../middleware/requireProjectAccess';
import * as attendanceService from '../services/attendance.service';
import { handleError } from '../utils/errors';

// ─── Schemas ──────────────────────────────────────────────────────────────────

const STATUSES = ['present', 'absent', 'late', 'half_day', 'excused'] as const;
const TIME_RE  = /^([01]\d|2[0-3]):[0-5]\d$/; // HH:MM

const createSchema = z.object({
  workerId:     z.string().uuid(),
  date:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  status:       z.enum(STATUSES),
  checkInTime:  z.string().regex(TIME_RE, 'Must be HH:MM').optional(),
  checkOutTime: z.string().regex(TIME_RE, 'Must be HH:MM').optional(),
  notes:        z.string().max(2000).optional(),
});

const updateSchema = z.object({
  status:       z.enum(STATUSES).optional(),
  checkInTime:  z.string().regex(TIME_RE, 'Must be HH:MM').nullish(),
  checkOutTime: z.string().regex(TIME_RE, 'Must be HH:MM').nullish(),
  notes:        z.string().max(2000).nullish(),
});

// ─── Role groups ──────────────────────────────────────────────────────────────

const VIEW_ROLES   = ['company_admin', 'project_manager', 'site_supervisor', 'finance_officer'] as const;
const WRITE_ROLES  = ['company_admin', 'project_manager', 'site_supervisor'] as const;
const DELETE_ROLES = ['company_admin', 'project_manager'] as const;

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function attendanceRoutes(fastify: FastifyInstance): Promise<void> {

  // GET /projects/:projectId/sites/:siteId/attendance
  // Query: date, startDate, endDate, workerId, status
  fastify.get(
    '/',
    { preHandler: [authenticate, requireRole(...VIEW_ROLES), requireProjectAccess] },
    async (request, reply) => {
      try {
        const { projectId, siteId } = request.params as { projectId: string; siteId: string };
        const q = request.query as Record<string, string>;
        const records = await attendanceService.listAttendanceRecords(
          projectId, siteId, request.user, {
            date:      q['date'],
            startDate: q['startDate'],
            endDate:   q['endDate'],
            workerId:  q['workerId'],
            status:    q['status'] as AttendanceStatus | undefined,
          },
        );
        return reply.send({ records });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // GET /projects/:projectId/sites/:siteId/attendance/summary?date=YYYY-MM-DD
  fastify.get(
    '/summary',
    { preHandler: [authenticate, requireRole(...VIEW_ROLES), requireProjectAccess] },
    async (request, reply) => {
      try {
        const { projectId, siteId } = request.params as { projectId: string; siteId: string };
        const q = request.query as Record<string, string>;
        const date = q['date'] ?? new Date().toISOString().split('T')[0];
        const summary = await attendanceService.getAttendanceSummary(
          projectId, siteId, request.user, date,
        );
        return reply.send({ summary, date });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // POST /projects/:projectId/sites/:siteId/attendance
  fastify.post(
    '/',
    { preHandler: [authenticate, requireRole(...WRITE_ROLES), requireProjectAccess] },
    async (request, reply) => {
      const parsed = createSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          error: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: parsed.error.flatten().fieldErrors,
        });
      }
      try {
        const { projectId, siteId } = request.params as { projectId: string; siteId: string };
        const record = await attendanceService.createAttendanceRecord(
          projectId, siteId, parsed.data, request.user,
        );
        return reply.status(201).send({ record });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // POST /projects/:projectId/sites/:siteId/attendance/self
  // Worker submits their own attendance for today (role=worker only)
  fastify.post(
    '/self',
    { preHandler: [authenticate, requireRole('worker')] },
    async (request, reply) => {
      const parsed = z.object({
        checkInTime: z.string().regex(TIME_RE, 'Must be HH:MM').optional(),
        notes:       z.string().max(2000).optional(),
      }).safeParse(request.body);

      if (!parsed.success) {
        return reply.status(422).send({
          error: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: parsed.error.flatten().fieldErrors,
        });
      }

      try {
        const { projectId, siteId } = request.params as { projectId: string; siteId: string };
        const record = await attendanceService.selfAttendance(
          projectId, siteId, parsed.data, request.user,
        );
        return reply.status(201).send({ record });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // GET /projects/:projectId/sites/:siteId/attendance/:recordId
  fastify.get(
    '/:recordId',
    { preHandler: [authenticate, requireRole(...VIEW_ROLES), requireProjectAccess] },
    async (request, reply) => {
      try {
        const { projectId, siteId, recordId } = request.params as {
          projectId: string; siteId: string; recordId: string;
        };
        const record = await attendanceService.getAttendanceRecord(
          recordId, projectId, siteId, request.user,
        );
        return reply.send({ record });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // PATCH /projects/:projectId/sites/:siteId/attendance/:recordId
  fastify.patch(
    '/:recordId',
    { preHandler: [authenticate, requireRole(...WRITE_ROLES), requireProjectAccess] },
    async (request, reply) => {
      const parsed = updateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          error: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: parsed.error.flatten().fieldErrors,
        });
      }
      try {
        const { projectId, siteId, recordId } = request.params as {
          projectId: string; siteId: string; recordId: string;
        };
        const record = await attendanceService.updateAttendanceRecord(
          recordId, projectId, siteId, parsed.data, request.user,
        );
        return reply.send({ record });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // DELETE /projects/:projectId/sites/:siteId/attendance/:recordId
  fastify.delete(
    '/:recordId',
    { preHandler: [authenticate, requireRole(...DELETE_ROLES), requireProjectAccess] },
    async (request, reply) => {
      try {
        const { projectId, siteId, recordId } = request.params as {
          projectId: string; siteId: string; recordId: string;
        };
        await attendanceService.deleteAttendanceRecord(
          recordId, projectId, siteId, request.user,
        );
        return reply.status(204).send();
      } catch (err) { return handleError(err, reply); }
    },
  );
}
