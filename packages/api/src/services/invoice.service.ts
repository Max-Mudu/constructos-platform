import { prisma } from '../utils/prisma';
import { NotFoundError, ForbiddenError, ConflictError, ValidationError } from '../utils/errors';
import { RequestUser } from '../types';
import { InvoiceStatus, InvoiceVendorType } from '@prisma/client';
import { createNotification } from './notification.service';
import { emitToCompany } from './event-emitter.service';

// ─── RBAC helpers ─────────────────────────────────────────────────────────────

const MANAGE_ROLES = ['company_admin', 'finance_officer', 'project_manager'] as const;

function canManage(actor: RequestUser): boolean {
  return (MANAGE_ROLES as readonly string[]).includes(actor.role);
}

function canFinanceApprove(actor: RequestUser): boolean {
  return actor.role === 'company_admin' || actor.role === 'finance_officer';
}

async function audit(
  actor: RequestUser,
  action: 'create' | 'update' | 'delete',
  entityType: string,
  entityId: string,
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      companyId: actor.companyId,
      userId:    actor.id,
      userEmail: actor.email,
      userRole:  actor.role,
      action,
      entityType,
      entityId,
    },
  });
}

// ─── Input Types ──────────────────────────────────────────────────────────────

export interface CreateInvoiceInput {
  projectId:             string;
  siteId?:               string;
  invoiceNumber:         string;
  vendorType:            InvoiceVendorType;
  contractorId?:         string;
  supplierId?:           string;
  consultantUserId?:     string;
  vendorName:            string;
  budgetLineItemId?:     string;
  variationOrderId?:     string;
  deliveryRecordId?:     string;
  labourEntryId?:        string;
  marketingBudgetEntryId?: string;
  consultantCostEntryId?: string;
  subtotal:              number;
  taxAmount?:            number;
  totalAmount:           number;
  currency?:             string;
  issueDate:             string;  // ISO date
  dueDate:               string;  // ISO date
  notes?:                string;
  lineItems?:            CreateLineItemInput[];
}

export interface UpdateInvoiceInput {
  invoiceNumber?:        string;
  vendorName?:           string;
  siteId?:               string | null;
  contractorId?:         string | null;
  supplierId?:           string | null;
  consultantUserId?:     string | null;
  budgetLineItemId?:     string | null;
  variationOrderId?:     string | null;
  deliveryRecordId?:     string | null;
  labourEntryId?:        string | null;
  marketingBudgetEntryId?: string | null;
  consultantCostEntryId?: string | null;
  subtotal?:             number;
  taxAmount?:            number;
  totalAmount?:          number;
  currency?:             string;
  issueDate?:            string;
  dueDate?:              string;
  notes?:                string | null;
}

export interface CreateLineItemInput {
  description: string;
  quantity:    number;
  unitRate:    number;
  amount:      number;
  notes?:      string;
}

export interface RecordPaymentInput {
  amount:      number;
  paymentDate: string;  // ISO date
  method:      string;
  reference?:  string;
  notes?:      string;
}

// ─── Include shapes ────────────────────────────────────────────────────────────

const INVOICE_INCLUDE = {
  project:              { select: { id: true, name: true, code: true } },
  site:                 { select: { id: true, name: true } },
  contractor:           { select: { id: true, name: true, tradeSpecialization: true } },
  supplier:             { select: { id: true, name: true, contactPerson: true } },
  consultantUser:       { select: { id: true, firstName: true, lastName: true, consultantType: true } },
  createdBy:            { select: { id: true, firstName: true, lastName: true } },
  approvedBy:           { select: { id: true, firstName: true, lastName: true } },
  budgetLineItem:       { select: { id: true, category: true, description: true } },
  variationOrder:       { select: { id: true, referenceNumber: true, description: true, amount: true } },
  deliveryRecord:       { select: { id: true, deliveryNoteNumber: true, itemDescription: true, deliveryDate: true } },
  labourEntry:          { select: { id: true, date: true, hoursWorked: true, currency: true, worker: { select: { id: true, firstName: true, lastName: true } } } },
  marketingBudgetEntry: { select: { id: true, campaignName: true, channel: true, vendorAgency: true } },
  consultantCostEntry:  { select: { id: true, consultantName: true, consultantType: true, feeAgreed: true } },
  lineItems:            true,
  payments: {
    include: {
      recordedBy: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { createdAt: 'asc' as const },
  },
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getInvoiceOrThrow(invoiceId: string, companyId: string) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, companyId },
    include: INVOICE_INCLUDE,
  });
  if (!invoice) throw new NotFoundError('Invoice not found');
  return invoice;
}

function computeStatusFromPayments(
  totalAmount: number,
  paidAmount: number,
  currentStatus: InvoiceStatus,
  dueDate: Date,
): { status: InvoiceStatus; paidAt: Date | null } {
  const now = new Date();
  const total = Number(totalAmount);
  const paid  = Number(paidAmount);

  if (paid >= total && total > 0) {
    return { status: 'paid', paidAt: now };
  }
  if (paid > 0 && paid < total) {
    return { status: 'partially_paid', paidAt: null };
  }
  // No payments — if overdue and currently approved/submitted, mark overdue
  if (paid === 0 && dueDate < now &&
      (currentStatus === 'approved' || currentStatus === 'submitted' || currentStatus === 'partially_paid')) {
    return { status: 'overdue', paidAt: null };
  }
  return { status: currentStatus, paidAt: null };
}

// ─── List ─────────────────────────────────────────────────────────────────────

export interface ListInvoicesFilter {
  projectId?:   string;
  status?:      InvoiceStatus;
  vendorType?:  InvoiceVendorType;
  search?:      string;
  dateFrom?:    string;
  dateTo?:      string;
  overdue?:     boolean;
}

export async function listInvoices(actor: RequestUser, filter: ListInvoicesFilter = {}) {
  // First, mark overdue invoices
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  await prisma.invoice.updateMany({
    where: {
      companyId: actor.companyId,
      status:    { in: ['approved', 'submitted', 'partially_paid'] },
      dueDate:   { lt: today },
    },
    data: { status: 'overdue' },
  });

  const where: Record<string, unknown> = {
    companyId: actor.companyId,
  };

  if (filter.projectId)  where.projectId  = filter.projectId;
  if (filter.status)     where.status     = filter.status;
  if (filter.vendorType) where.vendorType = filter.vendorType;

  if (filter.dateFrom || filter.dateTo) {
    const dueDateFilter: Record<string, Date> = {};
    if (filter.dateFrom) dueDateFilter.gte = new Date(filter.dateFrom);
    if (filter.dateTo)   dueDateFilter.lte = new Date(filter.dateTo);
    where.dueDate = dueDateFilter;
  }

  if (filter.search) {
    const q = filter.search;
    where.OR = [
      { invoiceNumber: { contains: q, mode: 'insensitive' } },
      { vendorName:    { contains: q, mode: 'insensitive' } },
    ];
  }

  const invoices = await prisma.invoice.findMany({
    where,
    include: {
      project:    { select: { id: true, name: true, code: true } },
      site:       { select: { id: true, name: true } },
      contractor: { select: { id: true, name: true } },
      supplier:   { select: { id: true, name: true } },
      payments:   { select: { amount: true } },
      _count:     { select: { lineItems: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return invoices;
}

// ─── Get detail ───────────────────────────────────────────────────────────────

export async function getInvoice(invoiceId: string, actor: RequestUser) {
  return getInvoiceOrThrow(invoiceId, actor.companyId);
}

// ─── Create ───────────────────────────────────────────────────────────────────

export async function createInvoice(input: CreateInvoiceInput, actor: RequestUser) {
  if (!canManage(actor)) throw new ForbiddenError('Insufficient permissions to create invoices');

  // Validate project belongs to company
  const project = await prisma.project.findFirst({
    where: { id: input.projectId, companyId: actor.companyId },
  });
  if (!project) throw new NotFoundError('Project not found');

  // Check invoice number uniqueness
  const existing = await prisma.invoice.findFirst({
    where: { companyId: actor.companyId, invoiceNumber: input.invoiceNumber },
  });
  if (existing) throw new ConflictError(`Invoice number "${input.invoiceNumber}" already exists`);

  const invoice = await prisma.invoice.create({
    data: {
      companyId:              actor.companyId,
      projectId:              input.projectId,
      siteId:                 input.siteId              ?? null,
      invoiceNumber:          input.invoiceNumber,
      vendorType:             input.vendorType,
      contractorId:           input.contractorId         ?? null,
      supplierId:             input.supplierId            ?? null,
      consultantUserId:       input.consultantUserId      ?? null,
      vendorName:             input.vendorName,
      budgetLineItemId:       input.budgetLineItemId      ?? null,
      variationOrderId:       input.variationOrderId      ?? null,
      deliveryRecordId:       input.deliveryRecordId      ?? null,
      labourEntryId:          input.labourEntryId         ?? null,
      marketingBudgetEntryId: input.marketingBudgetEntryId ?? null,
      consultantCostEntryId:  input.consultantCostEntryId  ?? null,
      subtotal:               input.subtotal,
      taxAmount:              input.taxAmount  ?? 0,
      totalAmount:            input.totalAmount,
      currency:               input.currency  ?? 'USD',
      issueDate:              new Date(input.issueDate),
      dueDate:                new Date(input.dueDate),
      notes:                  input.notes     ?? null,
      createdById:            actor.id,
      lineItems: input.lineItems ? {
        create: input.lineItems.map((li) => ({
          companyId:   actor.companyId,
          description: li.description,
          quantity:    li.quantity,
          unitRate:    li.unitRate,
          amount:      li.amount,
          notes:       li.notes ?? null,
        })),
      } : undefined,
    },
    include: INVOICE_INCLUDE,
  });

  await audit(actor, 'create', 'Invoice', invoice.id);
  return invoice;
}

// ─── Update ───────────────────────────────────────────────────────────────────

export async function updateInvoice(invoiceId: string, input: UpdateInvoiceInput, actor: RequestUser) {
  if (!canManage(actor)) throw new ForbiddenError('Insufficient permissions');

  const invoice = await getInvoiceOrThrow(invoiceId, actor.companyId);
  if (!['draft', 'submitted'].includes(invoice.status)) {
    throw new ValidationError('Only draft or submitted invoices can be edited');
  }

  // Check invoice number uniqueness if changing
  if (input.invoiceNumber && input.invoiceNumber !== invoice.invoiceNumber) {
    const existing = await prisma.invoice.findFirst({
      where: { companyId: actor.companyId, invoiceNumber: input.invoiceNumber, id: { not: invoiceId } },
    });
    if (existing) throw new ConflictError(`Invoice number "${input.invoiceNumber}" already exists`);
  }

  const updated = await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      invoiceNumber:          input.invoiceNumber          ?? undefined,
      vendorName:             input.vendorName             ?? undefined,
      siteId:                 input.siteId,
      contractorId:           input.contractorId,
      supplierId:             input.supplierId,
      consultantUserId:       input.consultantUserId,
      budgetLineItemId:       input.budgetLineItemId,
      variationOrderId:       input.variationOrderId,
      deliveryRecordId:       input.deliveryRecordId,
      labourEntryId:          input.labourEntryId,
      marketingBudgetEntryId: input.marketingBudgetEntryId,
      consultantCostEntryId:  input.consultantCostEntryId,
      subtotal:               input.subtotal               ?? undefined,
      taxAmount:              input.taxAmount              ?? undefined,
      totalAmount:            input.totalAmount            ?? undefined,
      currency:               input.currency              ?? undefined,
      issueDate:              input.issueDate ? new Date(input.issueDate) : undefined,
      dueDate:                input.dueDate   ? new Date(input.dueDate)   : undefined,
      notes:                  input.notes,
    },
    include: INVOICE_INCLUDE,
  });

  await audit(actor, 'update', 'Invoice', invoiceId);
  return updated;
}

// ─── Delete ───────────────────────────────────────────────────────────────────

export async function deleteInvoice(invoiceId: string, actor: RequestUser) {
  if (!canFinanceApprove(actor)) throw new ForbiddenError('Only finance staff can delete invoices');

  const invoice = await getInvoiceOrThrow(invoiceId, actor.companyId);
  if (!['draft', 'cancelled'].includes(invoice.status)) {
    throw new ValidationError('Only draft or cancelled invoices can be deleted');
  }

  await prisma.invoice.delete({ where: { id: invoiceId } });
  await audit(actor, 'delete', 'Invoice', invoiceId);
}

// ─── Status transitions ───────────────────────────────────────────────────────

export async function submitInvoice(invoiceId: string, actor: RequestUser) {
  if (!canManage(actor)) throw new ForbiddenError('Insufficient permissions');
  const invoice = await getInvoiceOrThrow(invoiceId, actor.companyId);
  if (invoice.status !== 'draft') throw new ValidationError('Only draft invoices can be submitted');

  const updated = await prisma.invoice.update({
    where: { id: invoiceId },
    data:  { status: 'submitted' },
    include: INVOICE_INCLUDE,
  });

  await audit(actor, 'update', 'Invoice', invoiceId);

  if (invoice.createdById) {
    await createNotification({
      companyId:  actor.companyId,
      userId:     invoice.createdById,
      type:       'invoice_status_changed',
      title:      `Invoice ${invoice.invoiceNumber} submitted`,
      body:       `Invoice for ${invoice.vendorName} has been submitted for approval.`,
      entityType: 'Invoice',
      entityId:   invoiceId,
    });
  }
  emitToCompany(actor.companyId, { type: 'invoice_updated', payload: { invoiceId, status: 'submitted' } });

  return updated;
}

export async function approveInvoice(invoiceId: string, actor: RequestUser) {
  if (!canFinanceApprove(actor)) throw new ForbiddenError('Only finance staff can approve invoices');
  const invoice = await getInvoiceOrThrow(invoiceId, actor.companyId);
  if (!['submitted', 'draft'].includes(invoice.status)) throw new ValidationError('Invoice must be in draft or submitted state to approve');

  const updated = await prisma.invoice.update({
    where: { id: invoiceId },
    data:  { status: 'approved', approvedById: actor.id, approvedAt: new Date() },
    include: INVOICE_INCLUDE,
  });

  await audit(actor, 'update', 'Invoice', invoiceId);

  if (invoice.createdById) {
    await createNotification({
      companyId:  actor.companyId,
      userId:     invoice.createdById,
      type:       'invoice_status_changed',
      title:      `Invoice ${invoice.invoiceNumber} approved`,
      body:       `Invoice for ${invoice.vendorName} has been approved by ${actor.email}.`,
      entityType: 'Invoice',
      entityId:   invoiceId,
    });
  }
  emitToCompany(actor.companyId, { type: 'invoice_updated', payload: { invoiceId, status: 'approved' } });

  return updated;
}

export async function disputeInvoice(invoiceId: string, notes: string | undefined, actor: RequestUser) {
  if (!canFinanceApprove(actor)) throw new ForbiddenError('Only finance staff can dispute invoices');
  const invoice = await getInvoiceOrThrow(invoiceId, actor.companyId);
  if (['paid', 'cancelled'].includes(invoice.status)) throw new ValidationError('Paid or cancelled invoices cannot be disputed');

  const updated = await prisma.invoice.update({
    where: { id: invoiceId },
    data:  { status: 'disputed', notes: notes ?? invoice.notes },
    include: INVOICE_INCLUDE,
  });

  await audit(actor, 'update', 'Invoice', invoiceId);

  if (invoice.createdById) {
    await createNotification({
      companyId:  actor.companyId,
      userId:     invoice.createdById,
      type:       'invoice_status_changed',
      title:      `Invoice ${invoice.invoiceNumber} disputed`,
      body:       `Invoice for ${invoice.vendorName} has been marked as disputed${notes ? `: ${notes}` : '.'}`,
      entityType: 'Invoice',
      entityId:   invoiceId,
    });
  }
  emitToCompany(actor.companyId, { type: 'invoice_updated', payload: { invoiceId, status: 'disputed' } });

  return updated;
}

export async function cancelInvoice(invoiceId: string, actor: RequestUser) {
  if (!canFinanceApprove(actor)) throw new ForbiddenError('Only finance staff can cancel invoices');
  const invoice = await getInvoiceOrThrow(invoiceId, actor.companyId);
  if (invoice.status === 'paid') throw new ValidationError('Paid invoices cannot be cancelled');

  const updated = await prisma.invoice.update({
    where: { id: invoiceId },
    data:  { status: 'cancelled' },
    include: INVOICE_INCLUDE,
  });

  await audit(actor, 'update', 'Invoice', invoiceId);

  if (invoice.createdById) {
    await createNotification({
      companyId:  actor.companyId,
      userId:     invoice.createdById,
      type:       'invoice_status_changed',
      title:      `Invoice ${invoice.invoiceNumber} cancelled`,
      body:       `Invoice for ${invoice.vendorName} has been cancelled.`,
      entityType: 'Invoice',
      entityId:   invoiceId,
    });
  }
  emitToCompany(actor.companyId, { type: 'invoice_updated', payload: { invoiceId, status: 'cancelled' } });

  return updated;
}

// ─── Line items ───────────────────────────────────────────────────────────────

export async function addLineItem(invoiceId: string, input: CreateLineItemInput, actor: RequestUser) {
  if (!canManage(actor)) throw new ForbiddenError('Insufficient permissions');
  const invoice = await getInvoiceOrThrow(invoiceId, actor.companyId);
  if (!['draft', 'submitted'].includes(invoice.status)) {
    throw new ValidationError('Line items can only be added to draft or submitted invoices');
  }

  await prisma.invoiceLineItem.create({
    data: {
      invoiceId,
      companyId:   actor.companyId,
      description: input.description,
      quantity:    input.quantity,
      unitRate:    input.unitRate,
      amount:      input.amount,
      notes:       input.notes ?? null,
    },
  });

  await audit(actor, 'update', 'Invoice', invoiceId);
  return getInvoiceOrThrow(invoiceId, actor.companyId);
}

export async function deleteLineItem(invoiceId: string, lineItemId: string, actor: RequestUser) {
  if (!canManage(actor)) throw new ForbiddenError('Insufficient permissions');
  const invoice = await getInvoiceOrThrow(invoiceId, actor.companyId);
  if (!['draft', 'submitted'].includes(invoice.status)) {
    throw new ValidationError('Line items can only be removed from draft or submitted invoices');
  }

  const item = await prisma.invoiceLineItem.findFirst({
    where: { id: lineItemId, invoiceId },
  });
  if (!item) throw new NotFoundError('Line item not found');

  await prisma.invoiceLineItem.delete({ where: { id: lineItemId } });
  await audit(actor, 'update', 'Invoice', invoiceId);
}

// ─── Payments ─────────────────────────────────────────────────────────────────

export async function recordPayment(invoiceId: string, input: RecordPaymentInput, actor: RequestUser) {
  if (!canFinanceApprove(actor)) throw new ForbiddenError('Only finance staff can record payments');
  const invoice = await getInvoiceOrThrow(invoiceId, actor.companyId);

  if (!['approved', 'partially_paid', 'overdue'].includes(invoice.status)) {
    throw new ValidationError('Payments can only be recorded for approved, partially paid, or overdue invoices');
  }

  if (input.amount <= 0) throw new ValidationError('Payment amount must be greater than zero');

  const currentPaid = Number(invoice.paidAmount);
  const total       = Number(invoice.totalAmount);
  const newPaid     = currentPaid + input.amount;

  if (newPaid > total) {
    throw new ValidationError(`Payment of ${input.amount} would exceed total invoice amount of ${total}`);
  }

  // Create payment record
  const payment = await prisma.invoicePayment.create({
    data: {
      invoiceId,
      companyId:   actor.companyId,
      amount:      input.amount,
      currency:    invoice.currency,
      paymentDate: new Date(input.paymentDate),
      method:      input.method,
      reference:   input.reference ?? null,
      notes:       input.notes     ?? null,
      recordedById: actor.id,
    },
  });

  // Determine new status
  const { status: newStatus, paidAt } = computeStatusFromPayments(
    total,
    newPaid,
    invoice.status,
    invoice.dueDate,
  );

  // Update invoice paidAmount and status
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      paidAmount: newPaid,
      status:     newStatus,
      paidAt:     paidAt ?? undefined,
    },
  });

  await audit(actor, 'update', 'Invoice', invoiceId);
  return payment;
}

export async function deletePayment(invoiceId: string, paymentId: string, actor: RequestUser) {
  if (!canFinanceApprove(actor)) throw new ForbiddenError('Only finance staff can remove payments');
  const invoice = await getInvoiceOrThrow(invoiceId, actor.companyId);

  const payment = await prisma.invoicePayment.findFirst({
    where: { id: paymentId, invoiceId },
  });
  if (!payment) throw new NotFoundError('Payment record not found');

  await prisma.invoicePayment.delete({ where: { id: paymentId } });

  // Recompute paidAmount from remaining payments
  const remaining = await prisma.invoicePayment.aggregate({
    where:  { invoiceId },
    _sum:   { amount: true },
  });
  const newPaid = Number(remaining._sum.amount ?? 0);
  const total   = Number(invoice.totalAmount);

  let newStatus: InvoiceStatus;
  if (newPaid >= total && total > 0) {
    newStatus = 'paid';
  } else if (newPaid > 0) {
    newStatus = 'partially_paid';
  } else {
    newStatus = 'approved';
  }

  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      paidAmount: newPaid,
      status:     newStatus,
      paidAt:     newPaid >= total ? invoice.paidAt : null,
    },
  });

  await audit(actor, 'update', 'Invoice', invoiceId);
}

// ─── Summary ──────────────────────────────────────────────────────────────────

export interface InvoiceSummary {
  totalCount:       number;
  totalValue:       number;
  totalPaid:        number;
  totalOutstanding: number;
  overdueCount:     number;
  overdueValue:     number;
  byStatus:         Record<string, { count: number; value: number }>;
  byVendorType:     Record<string, { count: number; value: number }>;
}

export async function getInvoiceSummary(actor: RequestUser, projectId?: string): Promise<InvoiceSummary> {
  const where: Record<string, unknown> = { companyId: actor.companyId };
  if (projectId) where.projectId = projectId;

  const invoices = await prisma.invoice.findMany({
    where,
    select: { status: true, totalAmount: true, paidAmount: true, vendorType: true, dueDate: true },
  });

  const summary: InvoiceSummary = {
    totalCount:       0,
    totalValue:       0,
    totalPaid:        0,
    totalOutstanding: 0,
    overdueCount:     0,
    overdueValue:     0,
    byStatus:         {},
    byVendorType:     {},
  };

  for (const inv of invoices) {
    const total = Number(inv.totalAmount);
    const paid  = Number(inv.paidAmount);
    const outstanding = total - paid;

    summary.totalCount++;
    summary.totalValue       += total;
    summary.totalPaid        += paid;
    summary.totalOutstanding += outstanding;

    if (inv.status === 'overdue') {
      summary.overdueCount++;
      summary.overdueValue += outstanding;
    }

    // By status
    if (!summary.byStatus[inv.status]) summary.byStatus[inv.status] = { count: 0, value: 0 };
    summary.byStatus[inv.status].count++;
    summary.byStatus[inv.status].value += total;

    // By vendor type
    if (!summary.byVendorType[inv.vendorType]) summary.byVendorType[inv.vendorType] = { count: 0, value: 0 };
    summary.byVendorType[inv.vendorType].count++;
    summary.byVendorType[inv.vendorType].value += total;
  }

  return summary;
}
