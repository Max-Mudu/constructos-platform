import { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/authenticate';
import { getDashboardStats } from '../services/dashboard.service';
import { handleError } from '../utils/errors';

export async function dashboardRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /dashboard — aggregated stats limited to the caller's read scope (see dashboard.service)
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
