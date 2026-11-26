/**
 * A labour entry that an invoice references cannot be deleted (owner rule,
 * 25 Nov 2026). Deleting it used to succeed and silently clear the
 * invoice's link (invoices.labourEntryId is ON DELETE SET NULL), so the
 * invoice lost what it was for.
 *
 * The refusal applies whatever the invoice's status; nothing else about
 * labour changes (entries can still be corrected with an edit, which is
 * audited, and an entry no invoice references can still be deleted).
 */
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import {
  createTestCompany,
  createTestUser,
  createTestProject,
  createTestSite,
  createTestWorker,
  assignWorkerToSite,
  assignUserToProject,
  createTestLabourEntry,
  createTestInvoice,
  clearDatabase,
  TestUser,
} from './helpers/fixtures';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await clearDatabase();
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await clearDatabase();
});

async function world(slug: string) {
  const { company, admin } = await createTestCompany(app, slug);
  const pm      = await createTestUser(app, company.id, 'project_manager', `${slug}-pm`);
  const project = await createTestProject(company.id);
  const site    = await createTestSite(company.id, project.id);
  await assignUserToProject(company.id, project.id, pm.id);
  const worker  = await createTestWorker(company.id);
  await assignWorkerToSite(company.id, project.id, site.id, worker.id, admin.id);
  const entry   = await createTestLabourEntry(company.id, project.id, site.id, worker.id, admin.id);
  const url     = `/api/v1/projects/${project.id}/sites/${site.id}/labour/${entry.id}`;
  return { company, admin, pm, project, site, worker, entry, url };
}

const del = (url: string, user: TestUser) =>
  app.inject({ method: 'DELETE', url, headers: { authorization: `Bearer ${user.accessToken}` } });

describe('DELETE labour entry referenced by an invoice', () => {
  it.each(['draft', 'submitted', 'approved', 'partially_paid', 'paid', 'overdue', 'disputed', 'cancelled'] as const)(
    'is refused when a %s invoice references it, and nothing changes',
    async (status) => {
      const w = await world(`inv-lab-${status}`);
      const invoice = await createTestInvoice(w.company.id, w.project.id, { status });
      await prisma.invoice.update({ where: { id: invoice.id }, data: { labourEntryId: w.entry.id } });

      const res = await del(w.url, w.admin);
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('LABOUR_ENTRY_INVOICED');
      expect(res.json().error).toMatch(/invoice/i);

      expect(await prisma.labourEntry.findUnique({ where: { id: w.entry.id } })).not.toBeNull();
      const after = await prisma.invoice.findUnique({ where: { id: invoice.id } });
      expect(after?.labourEntryId).toBe(w.entry.id);
      expect(await prisma.auditLog.count({ where: { action: 'delete', entityType: 'labour_entry', entityId: w.entry.id } })).toBe(0);
    },
  );

  it('is refused for a project manager too, without naming the invoice', async () => {
    const w = await world('inv-lab-pm');
    const invoice = await createTestInvoice(w.company.id, w.project.id, { status: 'approved', invoiceNumber: 'SECRET-INV-77' });
    await prisma.invoice.update({ where: { id: invoice.id }, data: { labourEntryId: w.entry.id } });

    const res = await del(w.url, w.pm);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('LABOUR_ENTRY_INVOICED');
    expect(res.payload).not.toContain('SECRET-INV-77');
  });

  it('an entry no invoice references can still be deleted (and is audited)', async () => {
    const w = await world('inv-lab-free');
    const other = await createTestLabourEntry(w.company.id, w.project.id, w.site.id, w.worker.id, w.admin.id, { date: new Date('2026-04-08') });
    const invoice = await createTestInvoice(w.company.id, w.project.id, { status: 'approved' });
    await prisma.invoice.update({ where: { id: invoice.id }, data: { labourEntryId: other.id } });

    const res = await del(w.url, w.pm);
    expect(res.statusCode).toBe(204);
    expect(await prisma.labourEntry.findUnique({ where: { id: w.entry.id } })).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: 'delete', entityType: 'labour_entry', entityId: w.entry.id } })).toBe(1);
  });

  it('can be deleted once a draft invoice no longer references it (existing invoice edit)', async () => {
    const w = await world('inv-lab-unlink');
    const invoice = await createTestInvoice(w.company.id, w.project.id, { status: 'draft' });
    await prisma.invoice.update({ where: { id: invoice.id }, data: { labourEntryId: w.entry.id } });

    expect((await del(w.url, w.admin)).statusCode).toBe(409);
    const unlink = await app.inject({
      method: 'PATCH', url: `/api/v1/invoices/${invoice.id}`,
      headers: { authorization: `Bearer ${w.admin.accessToken}` },
      payload: { labourEntryId: null },
    });
    expect(unlink.statusCode).toBe(200);
    expect((await del(w.url, w.admin)).statusCode).toBe(204);
  });

  it('editing an invoiced entry is unchanged (still allowed and audited)', async () => {
    const w = await world('inv-lab-edit');
    const invoice = await createTestInvoice(w.company.id, w.project.id, { status: 'approved' });
    await prisma.invoice.update({ where: { id: invoice.id }, data: { labourEntryId: w.entry.id } });

    const res = await app.inject({
      method: 'PATCH', url: w.url, headers: { authorization: `Bearer ${w.admin.accessToken}` },
      payload: { hoursWorked: 6 },
    });
    expect(res.statusCode).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: 'update', entityType: 'labour_entry', entityId: w.entry.id } })).toBe(1);
  });
});
