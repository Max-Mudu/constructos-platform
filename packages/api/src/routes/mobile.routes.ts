/**
 * Mobile-friendly global list endpoints.
 * Provides company-scoped, paginated, searchable lists of labour and delivery
 * records without requiring a projectId/siteId prefix.
 * Used by the mobile app where the supervisor/PM browses across all sites.
 */
import { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import { prisma } from '../utils/prisma';
import { handleError } from '../utils/errors';

const LABOUR_VIEW_ROLES    = ['company_admin', 'project_manager', 'site_supervisor', 'finance_officer'] as const;
const DELIVERY_VIEW_ROLES  = ['company_admin', 'project_manager', 'site_supervisor', 'finance_officer'] as const;

const PAGE_LIMIT = 25; // default page size

export async function mobileRoutes(fastify: FastifyInstance): Promise<void> {

  // ─────────────────────────────────────────────────────────────────────────
  // GET /api/v1/labour
  // Company-scoped labour list with search + pagination.
  // Query: projectId? siteId? workerId? date? startDate? endDate? search? limit? offset?
  // ─────────────────────────────────────────────────────────────────────────
  fastify.get(
    '/labour',
    { preHandler: [authenticate, requireRole(...LABOUR_VIEW_ROLES)] },
    async (request, reply) => {
      try {
        const q = request.query as Record<string, string>;
        const companyId  = request.user.companyId;
        const limit      = Math.min(parseInt(q['limit']  ?? `${PAGE_LIMIT}`, 10), 100);
        const offset     = Math.max(parseInt(q['offset'] ?? '0',             10), 0);
        const search     = q['search']?.trim();
        const projectId  = q['projectId'];
        const siteId     = q['siteId'];
        const workerId   = q['workerId'];
        const date       = q['date'];
        const startDate  = q['startDate'];
        const endDate    = q['endDate'];

        // Build date filter
        let dateFilter: object = {};
        if (date) {
          const d = new Date(date);
          const next = new Date(d); next.setDate(next.getDate() + 1);
          dateFilter = { date: { gte: d, lt: next } };
        } else if (startDate || endDate) {
          const range: { gte?: Date; lte?: Date } = {};
          if (startDate) range.gte = new Date(startDate);
          if (endDate)   range.lte = new Date(endDate);
          dateFilter = { date: range };
        }

        const where = {
          companyId,
          ...(projectId && { projectId }),
          ...(siteId    && { siteId    }),
          ...(workerId  && { workerId  }),
          ...dateFilter,
          ...(search && {
            worker: {
              OR: [
                { firstName: { contains: search, mode: 'insensitive' as const } },
                { lastName:  { contains: search, mode: 'insensitive' as const } },
              ],
            },
          }),
        };

        const [entries, total] = await Promise.all([
          prisma.labourEntry.findMany({
            where,
            include: {
              worker: { select: { id: true, firstName: true, lastName: true, trade: true } },
            },
            orderBy: { date: 'desc' },
            take:   limit,
            skip:   offset,
          }),
          prisma.labourEntry.count({ where }),
        ]);

        return reply.send({
          entries,
          pagination: { total, limit, offset, hasMore: offset + entries.length < total },
        });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // ─────────────────────────────────────────────────────────────────────────
  // GET /api/v1/deliveries
  // Company-scoped delivery list with search + pagination.
  // Query: projectId? siteId? date? search? acceptanceStatus? limit? offset?
  // ─────────────────────────────────────────────────────────────────────────
  fastify.get(
    '/deliveries',
    { preHandler: [authenticate, requireRole(...DELIVERY_VIEW_ROLES)] },
    async (request, reply) => {
      try {
        const q = request.query as Record<string, string>;
        const companyId        = request.user.companyId;
        const limit            = Math.min(parseInt(q['limit']  ?? `${PAGE_LIMIT}`, 10), 100);
        const offset           = Math.max(parseInt(q['offset'] ?? '0',             10), 0);
        const search           = q['search']?.trim();
        const projectId        = q['projectId'];
        const siteId           = q['siteId'];
        const date             = q['date'];
        const acceptanceStatus = q['acceptanceStatus'];

        let dateFilter: object = {};
        if (date) {
          const d = new Date(date);
          const next = new Date(d); next.setDate(next.getDate() + 1);
          dateFilter = { deliveryDate: { gte: d, lt: next } };
        }

        const where: Prisma.DeliveryRecordWhereInput = {
          companyId,
          ...(projectId && { projectId }),
          ...(siteId    && { siteId    }),
          ...(acceptanceStatus && {
            acceptanceStatus: acceptanceStatus as Prisma.EnumAcceptanceStatusFilter['equals'],
          }),
          ...dateFilter,
          ...(search && {
            supplierName: { contains: search, mode: 'insensitive' as const },
          }),
        };

        const [records, total] = await Promise.all([
          prisma.deliveryRecord.findMany({
            where,
            include: {
              photos: { select: { id: true, fileUrl: true, fileName: true } },
            },
            orderBy: { deliveryDate: 'desc' },
            take:   limit,
            skip:   offset,
          }),
          prisma.deliveryRecord.count({ where }),
        ]);

        return reply.send({
          records,
          pagination: { total, limit, offset, hasMore: offset + records.length < total },
        });
      } catch (err) { return handleError(err, reply); }
    },
  );
}
