import { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/authenticate';
import { handleError, ForbiddenError } from '../utils/errors';
import { prisma } from '../utils/prisma';

// Roles that can see the company activity feed
const ACTIVITY_ROLES = ['company_admin', 'finance_officer', 'project_manager'] as const;

export async function activityRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/activity
   * Query params:
   *   limit      = number (default 20, max 100)
   *   entityType = filter by entity type
   *   startDate  = ISO date filter
   *   endDate    = ISO date filter
   *
   * Returns recent audit log entries for the company.
   * RBAC: company_admin, finance_officer, project_manager
   */
  fastify.get<{
    Querystring: {
      limit?:      string;
      entityType?: string;
      startDate?:  string;
      endDate?:    string;
    };
  }>(
    '/',
    { preHandler: [authenticate] },
    async (request, reply) => {
      try {
        const actor = request.user;

        if (!(ACTIVITY_ROLES as readonly string[]).includes(actor.role)) {
          throw new ForbiddenError('Insufficient permissions to view activity feed');
        }

        const limit = Math.min(parseInt(request.query.limit ?? '20', 10) || 20, 100);
        const { entityType, startDate, endDate } = request.query;

        const dateFilter: { gte?: Date; lte?: Date } = {};
        if (startDate) dateFilter.gte = new Date(startDate);
        if (endDate)   dateFilter.lte = new Date(endDate);

        const activities = await prisma.auditLog.findMany({
          where: {
            companyId:  actor.companyId,
            ...(entityType && { entityType }),
            ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter }),
          },
          select: {
            id:         true,
            action:     true,
            entityType: true,
            entityId:   true,
            userEmail:  true,
            userRole:   true,
            createdAt:  true,
          },
          orderBy: { createdAt: 'desc' },
          take:    limit,
        });

        return reply.send({ activities });
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );
}
