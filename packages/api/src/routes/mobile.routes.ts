/**
 * Mobile-friendly global list endpoints.
 * Provides paginated, searchable lists of labour and delivery records without
 * requiring a projectId/siteId prefix. Results are limited to the caller's read
 * scope: company-wide roles see every company project; other roles see only
 * projects they are an active member of, and site_supervisors only their
 * assigned sites. An out-of-scope projectId/siteId returns 404.
 * Labour wage fields (dailyRate, currency) are financial and are omitted unless
 * canViewFinancialData(user) — see report.service.
 */
import { FastifyInstance } from 'fastify';
import { Prisma, AcceptanceStatus } from '@prisma/client';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import { prisma } from '../utils/prisma';
import { handleError } from '../utils/errors';
import { canViewFinancialData, resolveReadScope, scopeWhere } from '../services/report.service';

const LABOUR_VIEW_ROLES    = ['company_admin', 'project_manager', 'site_supervisor', 'finance_officer'] as const;
const DELIVERY_VIEW_ROLES  = ['company_admin', 'project_manager', 'site_supervisor', 'finance_officer'] as const;

const PAGE_LIMIT = 25; // default page size

export async function mobileRoutes(fastify: FastifyInstance): Promise<void> {

  // ─────────────────────────────────────────────────────────────────────────
  // GET /api/v1/labour
  // Scoped labour list with search + pagination.
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

        const scope = await resolveReadScope(request.user, { projectId, siteId });

        const where: Prisma.LabourEntryWhereInput = {
          companyId,
          ...scopeWhere(scope),
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

        // Wage fields are financial: omit them for callers without finance visibility.
        const showWages = canViewFinancialData(request.user);
        const visibleEntries = showWages
          ? entries
          : entries.map(({ dailyRate: _rate, currency: _currency, ...rest }) => rest);

        return reply.send({
          entries: visibleEntries,
          financialFieldsIncluded: showWages,
          pagination: { total, limit, offset, hasMore: offset + entries.length < total },
        });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // ─────────────────────────────────────────────────────────────────────────
  // GET /api/v1/deliveries
  // Scoped delivery list with search + pagination.
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

        const scope = await resolveReadScope(request.user, { projectId, siteId });

        const where: Prisma.DeliveryRecordWhereInput = {
          companyId,
          ...scopeWhere(scope),
          ...(acceptanceStatus && {
            acceptanceStatus: acceptanceStatus as AcceptanceStatus,
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
