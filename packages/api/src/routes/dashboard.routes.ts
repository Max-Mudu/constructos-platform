import { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/authenticate';
import { getDashboardStats } from '../services/dashboard.service';
import { handleError } from '../utils/errors';

export async function dashboardRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /dashboard — returns aggregated company-wide stats for the authenticated user
  fastify.get(
    '/',
    { preHandler: [authenticate] },
    async (request, reply) => {
      try {
        const stats = await getDashboardStats(request.user);
        return reply.send({ stats });
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );
}
