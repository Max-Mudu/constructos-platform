import { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/authenticate';
import { handleError } from '../utils/errors';
import {
  listInvoices,
  getInvoice,
  createInvoice,
  updateInvoice,
  deleteInvoice,
  submitInvoice,
  approveInvoice,
  disputeInvoice,
  cancelInvoice,
  addLineItem,
  deleteLineItem,
  recordPayment,
  deletePayment,
  getInvoiceSummary,
  CreateInvoiceInput,
  UpdateInvoiceInput,
  CreateLineItemInput,
  RecordPaymentInput,
} from '../services/invoice.service';
import { InvoiceStatus, InvoiceVendorType } from '@prisma/client';

export async function invoiceRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  // ── GET / — list invoices ───────────────────────────────────────────────────
  app.get('/', async (request, reply) => {
    try {
      const q = request.query as {
        projectId?: string;
        status?:    string;
        vendorType?: string;
        search?:    string;
        dateFrom?:  string;
        dateTo?:    string;
      };
      const invoices = await listInvoices(request.user, {
        projectId:  q.projectId,
        status:     q.status     as InvoiceStatus  | undefined,
        vendorType: q.vendorType as InvoiceVendorType | undefined,
        search:     q.search,
        dateFrom:   q.dateFrom,
        dateTo:     q.dateTo,
      });
      reply.send({ invoices });
    } catch (err) { handleError(err, reply); }
  });

  // ── GET /summary — aggregate stats ─────────────────────────────────────────
  app.get('/summary', async (request, reply) => {
    try {
      const { projectId } = request.query as { projectId?: string };
      const summary = await getInvoiceSummary(request.user, projectId);
      reply.send({ summary });
    } catch (err) { handleError(err, reply); }
  });

  // ── POST / — create invoice ─────────────────────────────────────────────────
  app.post('/', async (request, reply) => {
    try {
      const body = request.body as CreateInvoiceInput;
      if (!body.projectId)     return reply.status(422).send({ error: 'projectId is required',     code: 'VALIDATION_ERROR' });
      if (!body.invoiceNumber) return reply.status(422).send({ error: 'invoiceNumber is required', code: 'VALIDATION_ERROR' });
      if (!body.vendorName)    return reply.status(422).send({ error: 'vendorName is required',    code: 'VALIDATION_ERROR' });
      if (!body.vendorType)    return reply.status(422).send({ error: 'vendorType is required',    code: 'VALIDATION_ERROR' });
      if (!body.issueDate)     return reply.status(422).send({ error: 'issueDate is required',     code: 'VALIDATION_ERROR' });
      if (!body.dueDate)       return reply.status(422).send({ error: 'dueDate is required',       code: 'VALIDATION_ERROR' });
      if (body.subtotal    === undefined) return reply.status(422).send({ error: 'subtotal is required',    code: 'VALIDATION_ERROR' });
      if (body.totalAmount === undefined) return reply.status(422).send({ error: 'totalAmount is required', code: 'VALIDATION_ERROR' });

      const invoice = await createInvoice(body, request.user);
      reply.status(201).send({ invoice });
    } catch (err) { handleError(err, reply); }
  });

  // ── GET /:invoiceId — detail ────────────────────────────────────────────────
  app.get('/:invoiceId', async (request, reply) => {
    try {
      const { invoiceId } = request.params as { invoiceId: string };
      const invoice = await getInvoice(invoiceId, request.user);
      reply.send({ invoice });
    } catch (err) { handleError(err, reply); }
  });

  // ── PATCH /:invoiceId — update ──────────────────────────────────────────────
  app.patch('/:invoiceId', async (request, reply) => {
    try {
      const { invoiceId } = request.params as { invoiceId: string };
      const body = request.body as UpdateInvoiceInput;
      const invoice = await updateInvoice(invoiceId, body, request.user);
      reply.send({ invoice });
    } catch (err) { handleError(err, reply); }
  });

  // ── DELETE /:invoiceId — delete ─────────────────────────────────────────────
  app.delete('/:invoiceId', async (request, reply) => {
    try {
      const { invoiceId } = request.params as { invoiceId: string };
      await deleteInvoice(invoiceId, request.user);
      reply.status(204).send();
    } catch (err) { handleError(err, reply); }
  });

  // ── POST /:invoiceId/submit ─────────────────────────────────────────────────
  app.post('/:invoiceId/submit', async (request, reply) => {
    try {
      const { invoiceId } = request.params as { invoiceId: string };
      const invoice = await submitInvoice(invoiceId, request.user);
      reply.send({ invoice });
    } catch (err) { handleError(err, reply); }
  });

  // ── POST /:invoiceId/approve ────────────────────────────────────────────────
  app.post('/:invoiceId/approve', async (request, reply) => {
    try {
      const { invoiceId } = request.params as { invoiceId: string };
      const invoice = await approveInvoice(invoiceId, request.user);
      reply.send({ invoice });
    } catch (err) { handleError(err, reply); }
  });

  // ── POST /:invoiceId/dispute ────────────────────────────────────────────────
  app.post('/:invoiceId/dispute', async (request, reply) => {
    try {
      const { invoiceId } = request.params as { invoiceId: string };
      const body = request.body as { notes?: string };
      const invoice = await disputeInvoice(invoiceId, body?.notes, request.user);
      reply.send({ invoice });
    } catch (err) { handleError(err, reply); }
  });

  // ── POST /:invoiceId/cancel ─────────────────────────────────────────────────
  app.post('/:invoiceId/cancel', async (request, reply) => {
    try {
      const { invoiceId } = request.params as { invoiceId: string };
      const invoice = await cancelInvoice(invoiceId, request.user);
      reply.send({ invoice });
    } catch (err) { handleError(err, reply); }
  });

  // ── POST /:invoiceId/line-items — add line item ────────────────────────────
  app.post('/:invoiceId/line-items', async (request, reply) => {
    try {
      const { invoiceId } = request.params as { invoiceId: string };
      const body = request.body as CreateLineItemInput;
      if (!body.description) return reply.status(422).send({ error: 'description is required', code: 'VALIDATION_ERROR' });
      const invoice = await addLineItem(invoiceId, body, request.user);
      reply.status(201).send({ invoice });
    } catch (err) { handleError(err, reply); }
  });

  // ── DELETE /:invoiceId/line-items/:lineItemId ──────────────────────────────
  app.delete('/:invoiceId/line-items/:lineItemId', async (request, reply) => {
    try {
      const { invoiceId, lineItemId } = request.params as { invoiceId: string; lineItemId: string };
      await deleteLineItem(invoiceId, lineItemId, request.user);
      reply.status(204).send();
    } catch (err) { handleError(err, reply); }
  });

  // ── POST /:invoiceId/payments — record payment ─────────────────────────────
  app.post('/:invoiceId/payments', async (request, reply) => {
    try {
      const { invoiceId } = request.params as { invoiceId: string };
      const body = request.body as RecordPaymentInput;
      if (!body.amount)      return reply.status(422).send({ error: 'amount is required',      code: 'VALIDATION_ERROR' });
      if (!body.paymentDate) return reply.status(422).send({ error: 'paymentDate is required', code: 'VALIDATION_ERROR' });
      if (!body.method)      return reply.status(422).send({ error: 'method is required',      code: 'VALIDATION_ERROR' });
      const payment = await recordPayment(invoiceId, body, request.user);
      reply.status(201).send({ payment });
    } catch (err) { handleError(err, reply); }
  });

  // ── DELETE /:invoiceId/payments/:paymentId ─────────────────────────────────
  app.delete('/:invoiceId/payments/:paymentId', async (request, reply) => {
    try {
      const { invoiceId, paymentId } = request.params as { invoiceId: string; paymentId: string };
      await deletePayment(invoiceId, paymentId, request.user);
      reply.status(204).send();
    } catch (err) { handleError(err, reply); }
  });
}
