import { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/authenticate';
import {
  generateReport,
  isValidReportType,
  ReportFilters,
} from '../services/report.service';
import { toCSV, toExcel, toPDF } from '../utils/report-formatters';
import { handleError, NotFoundError, ValidationError } from '../utils/errors';

export async function reportRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/reports/:type
   * Query params:
   *   format      = json (default) | csv | xlsx | pdf
   *   projectId   = filter by project
   *   siteId      = filter by site
   *   startDate   = ISO date string (inclusive)
   *   endDate     = ISO date string (inclusive)
   */
  fastify.get<{
    Params: { type: string };
    Querystring: {
      format?: string;
      projectId?: string;
      siteId?: string;
      startDate?: string;
      endDate?: string;
    };
  }>(
    '/:type',
    { preHandler: [authenticate] },
    async (request, reply) => {
      try {
        const { type }                                      = request.params;
        const { format = 'json', projectId, siteId, startDate, endDate } = request.query;

        if (!isValidReportType(type)) {
          throw new NotFoundError('Report type');
        }

        const allowedFormats = ['json', 'csv', 'xlsx', 'pdf'];
        if (!allowedFormats.includes(format)) {
          throw new ValidationError(`Invalid format '${format}'. Allowed: json, csv, xlsx, pdf`);
        }

        const filters: ReportFilters = { projectId, siteId, startDate, endDate };

        const data = await generateReport(type, request.user, filters);

        if (format === 'csv') {
          const buf = toCSV(data);
          return reply
            .header('Content-Type', 'text/csv; charset=utf-8')
            .header('Content-Disposition', `attachment; filename="${type}-report.csv"`)
            .send(buf);
        }

        if (format === 'xlsx') {
          const buf = await toExcel(data);
          return reply
            .header(
              'Content-Type',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            )
            .header('Content-Disposition', `attachment; filename="${type}-report.xlsx"`)
            .send(buf);
        }

        if (format === 'pdf') {
          const buf = await toPDF(data);
          return reply
            .header('Content-Type', 'application/pdf')
            .header('Content-Disposition', `attachment; filename="${type}-report.pdf"`)
            .send(buf);
        }

        // Default: JSON
        return reply.send({ report: data });
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );
}
