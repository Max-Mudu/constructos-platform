import { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/authenticate';
import { handleError } from '../utils/errors';
import {
  listBudgets,
  getBudget,
  createBudget,
  updateBudget,
  deleteBudget,
  approveBudget,
  lockBudget,
  addLineItem,
  updateLineItem,
  deleteLineItem,
  addVariation,
  updateVariation,
  computeSummary,
  CreateBudgetInput,
  CreateLineItemInput,
  UpdateLineItemInput,
  CreateVariationInput,
  UpdateVariationInput,
} from '../services/budget.service';
import { BudgetStatus } from '@prisma/client';

export async function budgetRoutes(app: FastifyInstance) {
  // All routes require authentication
  app.addHook('preHandler', authenticate);

  // ── GET /budgets — list ────────────────────────────────────────────────────
  app.get('/', async (request, reply) => {
    try {
      const params = request.query as { projectId?: string; status?: string };
      const budgets = await listBudgets(request.user, {
        projectId: params.projectId,
        status:    params.status as BudgetStatus | undefined,
      });
      reply.send({ budgets });
    } catch (err) { handleError(err, reply); }
  });

  // ── POST /budgets — create ─────────────────────────────────────────────────
  app.post('/', async (request, reply) => {
    try {
      const body = request.body as CreateBudgetInput;
      if (!body.projectId) return reply.status(422).send({ error: 'projectId is required', code: 'VALIDATION_ERROR' });
      if (!body.name)      return reply.status(422).send({ error: 'name is required',      code: 'VALIDATION_ERROR' });
      const budget = await createBudget(body, request.user);
      reply.status(201).send({ budget });
    } catch (err) { handleError(err, reply); }
  });

  // ── GET /budgets/:budgetId ─────────────────────────────────────────────────
  app.get('/:budgetId', async (request, reply) => {
    try {
      const { budgetId } = request.params as { budgetId: string };
      const budget  = await getBudget(budgetId, request.user);
      const summary = computeSummary(budget);
      reply.send({ budget, summary });
    } catch (err) { handleError(err, reply); }
  });

  // ── PATCH /budgets/:budgetId ───────────────────────────────────────────────
  app.patch('/:budgetId', async (request, reply) => {
    try {
      const { budgetId } = request.params as { budgetId: string };
      const body = request.body as { name?: string; currency?: string; notes?: string | null };
      const budget = await updateBudget(budgetId, body, request.user);
      reply.send({ budget });
    } catch (err) { handleError(err, reply); }
  });

  // ── DELETE /budgets/:budgetId ──────────────────────────────────────────────
  app.delete('/:budgetId', async (request, reply) => {
    try {
      const { budgetId } = request.params as { budgetId: string };
      await deleteBudget(budgetId, request.user);
      reply.status(204).send();
    } catch (err) { handleError(err, reply); }
  });

  // ── POST /budgets/:budgetId/approve ────────────────────────────────────────
  app.post('/:budgetId/approve', async (request, reply) => {
    try {
      const { budgetId } = request.params as { budgetId: string };
      const budget = await approveBudget(budgetId, request.user);
      reply.send({ budget });
    } catch (err) { handleError(err, reply); }
  });

  // ── POST /budgets/:budgetId/lock ───────────────────────────────────────────
  app.post('/:budgetId/lock', async (request, reply) => {
    try {
      const { budgetId } = request.params as { budgetId: string };
      const budget = await lockBudget(budgetId, request.user);
      reply.send({ budget });
    } catch (err) { handleError(err, reply); }
  });

  // ── POST /budgets/:budgetId/line-items ─────────────────────────────────────
  app.post('/:budgetId/line-items', async (request, reply) => {
    try {
      const { budgetId } = request.params as { budgetId: string };
      const body = request.body as CreateLineItemInput;
      if (!body.category)       return reply.status(422).send({ error: 'category is required',       code: 'VALIDATION_ERROR' });
      if (!body.description)    return reply.status(422).send({ error: 'description is required',    code: 'VALIDATION_ERROR' });
      if (body.budgetedAmount === undefined) return reply.status(422).send({ error: 'budgetedAmount is required', code: 'VALIDATION_ERROR' });
      const lineItem = await addLineItem(budgetId, body, request.user);
      reply.status(201).send({ lineItem });
    } catch (err) { handleError(err, reply); }
  });

  // ── PATCH /budgets/:budgetId/line-items/:lineItemId ────────────────────────
  app.patch('/:budgetId/line-items/:lineItemId', async (request, reply) => {
    try {
      const { budgetId, lineItemId } = request.params as { budgetId: string; lineItemId: string };
      const body = request.body as UpdateLineItemInput;
      const lineItem = await updateLineItem(budgetId, lineItemId, body, request.user);
      reply.send({ lineItem });
    } catch (err) { handleError(err, reply); }
  });

  // ── DELETE /budgets/:budgetId/line-items/:lineItemId ───────────────────────
  app.delete('/:budgetId/line-items/:lineItemId', async (request, reply) => {
    try {
      const { budgetId, lineItemId } = request.params as { budgetId: string; lineItemId: string };
      await deleteLineItem(budgetId, lineItemId, request.user);
      reply.status(204).send();
    } catch (err) { handleError(err, reply); }
  });

  // ── POST /budgets/:budgetId/variations ─────────────────────────────────────
  app.post('/:budgetId/variations', async (request, reply) => {
    try {
      const { budgetId } = request.params as { budgetId: string };
      const body = request.body as CreateVariationInput;
      if (!body.referenceNumber) return reply.status(422).send({ error: 'referenceNumber is required', code: 'VALIDATION_ERROR' });
      if (!body.description)     return reply.status(422).send({ error: 'description is required',     code: 'VALIDATION_ERROR' });
      if (body.amount === undefined) return reply.status(422).send({ error: 'amount is required',       code: 'VALIDATION_ERROR' });
      const variation = await addVariation(budgetId, body, request.user);
      reply.status(201).send({ variation });
    } catch (err) { handleError(err, reply); }
  });

  // ── PATCH /budgets/:budgetId/variations/:variationId ──────────────────────
  app.patch('/:budgetId/variations/:variationId', async (request, reply) => {
    try {
      const { budgetId, variationId } = request.params as { budgetId: string; variationId: string };
      const body = request.body as UpdateVariationInput;
      const variation = await updateVariation(budgetId, variationId, body, request.user);
      reply.send({ variation });
    } catch (err) { handleError(err, reply); }
  });
}
