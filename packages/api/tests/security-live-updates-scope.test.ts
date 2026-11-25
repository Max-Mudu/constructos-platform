/**
 * Live updates reach only users who can read the record.
 *
 * Every user below has a live-updates connection registered the way GET
 * /events registers one (with the verified token payload). A real API write
 * then emits its event; each test checks exactly which users received it and
 * what it carried. The expected audiences are the read rules of each record's
 * GET route: role, project membership, site scope, contractor link and
 * financial scope, never another company, never an ended session.
 */
import { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { UserRole } from '@prisma/client';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import { env } from '../src/utils/env';
import { JwtPayload } from '../src/types';
import {
  registerClient,
  unregisterClient,
  liveUpdatesSettled,
  Client,
} from '../src/services/event-emitter.service';
import {
  createTestCompany,
  createTestUser,
  createTestProject,
  createTestSite,
  assignUserToProject,
  createTestWorker,
  assignWorkerToSite,
  createTestContractor,
  createTestInvoice,
  createTestInstruction,
  clearDatabase,
  TestUser,
} from './helpers/fixtures';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

// ─── World ───────────────────────────────────────────────────────────────────

interface World {
  companyId: string;
  p1: string; p2: string; s1: string; s2: string;
  c1: string;
  workerId: string;
  users: Record<string, TestUser>;
  b: { companyId: string; project: string; site: string; admin: TestUser };
}

let world: World;
const clients: Client[] = [];
const received = new Map<string, Array<{ type: string; data: Record<string, unknown> }>>();

function connect(name: string, user: TestUser): void {
  const session = app.jwt.verify<JwtPayload>(user.accessToken);
  const client: Client = {
    id: randomUUID(), userId: user.id, companyId: session.companyId, session,
    write: (line: string) => {
      const type = /^event: (.+)$/m.exec(line)?.[1] ?? '';
      const data = JSON.parse(/^data: (.+)$/m.exec(line)?.[1] ?? '{}') as Record<string, unknown>;
      received.get(name)!.push({ type, data });
    },
  };
  received.set(name, []);
  registerClient(client);
  clients.push(client);
}

async function member(user: TestUser, projectId: string, siteId?: string): Promise<void> {
  await assignUserToProject(user.companyId, projectId, user.id, siteId);
}

beforeEach(async () => {
  await clearDatabase();
  received.clear();

  const { company, admin } = await createTestCompany(app, `lu-a-${randomUUID().slice(0, 8)}`);
  const companyId = company.id;
  const p1 = (await createTestProject(companyId, 'P1')).id;
  const p2 = (await createTestProject(companyId, 'P2')).id;
  const s1 = (await createTestSite(companyId, p1, 'S1')).id;
  const s2 = (await createTestSite(companyId, p1, 'S2')).id;

  const mk = (role: UserRole, suffix: string, finance = false) =>
    createTestUser(app, companyId, role, `${suffix}-${randomUUID().slice(0, 6)}`, { canViewFinance: finance });

  const users: Record<string, TestUser> = { admin };
  users.pm1        = await mk('project_manager', 'pm1');          await member(users.pm1, p1);
  users.pmFin      = await mk('project_manager', 'pmfin', true);  await member(users.pmFin, p1);
  users.pm2Fin     = await mk('project_manager', 'pm2fin', true); await member(users.pm2Fin, p2);
  users.sup1       = await mk('site_supervisor', 'sup1');         await member(users.sup1, p1, s1);
  users.sup2       = await mk('site_supervisor', 'sup2');         await member(users.sup2, p1, s2);
  users.supAll     = await mk('site_supervisor', 'supall');       await member(users.supAll, p1);
  users.fin        = await mk('finance_officer', 'fin', true);
  users.viewer1    = await mk('viewer', 'viewer1');               await member(users.viewer1, p1);
  users.viewerOut  = await mk('viewer', 'viewerout');
  users.cons1      = await mk('consultant', 'cons1');             await member(users.cons1, p1);
  users.ctr1       = await mk('contractor', 'ctr1');              await member(users.ctr1, p1);
  users.ctr2       = await mk('contractor', 'ctr2');              await member(users.ctr2, p1);
  users.worker1    = await mk('worker', 'worker1');               await member(users.worker1, p1);
  users.removedPm  = await mk('project_manager', 'removedpm', true); await member(users.removedPm, p1);
  await prisma.projectMember.updateMany({ where: { userId: users.removedPm.id }, data: { removedAt: new Date() } });
  users.inactive   = await mk('company_admin', 'inactive', true);
  await prisma.user.update({ where: { id: users.inactive.id }, data: { isActive: false } });
  users.ended      = await mk('company_admin', 'ended', true);
  await prisma.user.update({ where: { id: users.ended.id }, data: { sessionVersion: { increment: 1 } } });

  const c1 = (await createTestContractor(companyId, 'C1', users.ctr1.id)).id;
  await createTestContractor(companyId, 'C2', users.ctr2.id);
  const workerId = (await createTestWorker(companyId)).id;
  await assignWorkerToSite(companyId, p1, s1, workerId, admin.id);

  const other = await createTestCompany(app, `lu-b-${randomUUID().slice(0, 8)}`);
  const bProject = (await createTestProject(other.company.id, 'B1')).id;
  const bSite = (await createTestSite(other.company.id, bProject, 'BS1')).id;

  world = {
    companyId, p1, p2, s1, s2, c1, workerId, users,
    b: { companyId: other.company.id, project: bProject, site: bSite, admin: other.admin },
  };

  for (const [name, user] of Object.entries(users)) connect(name, user);
  connect('adminB', other.admin);
});

afterEach(() => {
  for (const client of clients.splice(0)) unregisterClient(client);
});

const ALL = () => [...received.keys()].sort();

/** Names of the connections that received `type`. */
async function receiversOf(type: string): Promise<string[]> {
  await liveUpdatesSettled();
  return [...received.entries()].filter(([, events]) => events.some((e) => e.type === type)).map(([n]) => n).sort();
}

function payloadsOf(name: string, type: string): Array<Record<string, unknown>> {
  return (received.get(name) ?? []).filter((e) => e.type === type).map((e) => e.data);
}

function auth(user: TestUser) {
  return { authorization: `Bearer ${user.accessToken}` };
}

// ─── delivery_created ────────────────────────────────────────────────────────

async function createDelivery(actor: TestUser, projectId: string, siteId: string) {
  const res = await app.inject({
    method: 'POST', url: `/api/v1/projects/${projectId}/sites/${siteId}/deliveries`, headers: auth(actor),
    payload: {
      supplierName: 'Supplier', deliveryDate: '2026-11-20', itemDescription: 'Cement', unitOfMeasure: 'bags',
      quantityOrdered: 10, quantityDelivered: 10, receivedById: actor.id,
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json().delivery.id as string;
}

describe('delivery_created', () => {
  it('reaches delivery readers of that project and site only', async () => {
    const id = await createDelivery(world.users.sup1, world.p1, world.s1);
    expect(await receiversOf('delivery_created')).toEqual(
      ['admin', 'fin', 'pm1', 'pmFin', 'sup1', 'supAll', 'viewer1'].sort(),
    );
    expect(payloadsOf('pm1', 'delivery_created')).toEqual([{ deliveryId: id, projectId: world.p1, siteId: world.s1 }]);
  });

  it('a delivery on the other site reaches that site\'s supervisor, not this one\'s', async () => {
    await createDelivery(world.users.admin, world.p1, world.s2);
    const got = await receiversOf('delivery_created');
    expect(got).toContain('sup2');
    expect(got).not.toContain('sup1');
  });
});

// ─── labour_created ──────────────────────────────────────────────────────────

describe('labour_created', () => {
  it('reaches labour readers of that project and site only, with ids only', async () => {
    const res = await app.inject({
      method: 'POST', url: `/api/v1/projects/${world.p1}/sites/${world.s1}/labour`, headers: auth(world.users.sup1),
      payload: { workerId: world.workerId, date: '2026-11-20', hoursWorked: 8 },
    });
    expect(res.statusCode).toBe(201);
    const id = res.json().entry.id as string;
    expect(await receiversOf('labour_created')).toEqual(['admin', 'fin', 'pm1', 'pmFin', 'sup1', 'supAll'].sort());
    expect(payloadsOf('sup1', 'labour_created')).toEqual([{ entryId: id, projectId: world.p1, siteId: world.s1 }]);
  });
});

// ─── instruction_updated ─────────────────────────────────────────────────────

const INSTRUCTION_READERS = ['admin', 'cons1', 'ctr1', 'pm1', 'pmFin', 'sup1', 'sup2', 'supAll', 'viewer1'];

describe('instruction_updated', () => {
  it('created: reaches project members who can view instructions, and only the linked contractor', async () => {
    const res = await app.inject({
      method: 'POST', url: `/api/v1/projects/${world.p1}/instructions`, headers: auth(world.users.admin),
      payload: { type: 'instruction', title: 'Fix it', issuedDate: '2026-11-20', siteId: world.s1, contractorId: world.c1 },
    });
    expect(res.statusCode).toBe(201);
    const id = res.json().instruction.id as string;
    expect(await receiversOf('instruction_updated')).toEqual([...INSTRUCTION_READERS].sort());
    expect(payloadsOf('cons1', 'instruction_updated')).toEqual([{ instructionId: id, projectId: world.p1, action: 'created' }]);
  });

  it('updated: same audience', async () => {
    const instr = await createTestInstruction(world.companyId, world.p1, world.users.admin.id,
      { siteId: world.s1, contractorId: world.c1 });
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/projects/${world.p1}/instructions/${instr.id}`, headers: auth(world.users.admin),
      payload: { title: 'Renamed' },
    });
    expect(res.statusCode).toBe(200);
    expect(await receiversOf('instruction_updated')).toEqual([...INSTRUCTION_READERS].sort());
    expect(payloadsOf('admin', 'instruction_updated')).toEqual([{ instructionId: instr.id, projectId: world.p1, action: 'updated' }]);
  });

  it('with SITE_SCOPE_STRICT on, another site\'s supervisor does not receive a site instruction', async () => {
    const mutable = env as unknown as Record<string, unknown>;
    const saved = mutable['SITE_SCOPE_STRICT'];
    mutable['SITE_SCOPE_STRICT'] = true;
    try {
      const instr = await createTestInstruction(world.companyId, world.p1, world.users.admin.id,
        { siteId: world.s1, contractorId: world.c1 });
      const res = await app.inject({
        method: 'PATCH', url: `/api/v1/projects/${world.p1}/instructions/${instr.id}`, headers: auth(world.users.admin),
        payload: { title: 'Renamed' },
      });
      expect(res.statusCode).toBe(200);
      const got = await receiversOf('instruction_updated');
      expect(got).not.toContain('sup2');
      expect(got).toContain('sup1');
    } finally {
      mutable['SITE_SCOPE_STRICT'] = saved;
    }
  });
});

// ─── invoice_updated ─────────────────────────────────────────────────────────

describe('invoice_updated', () => {
  it.each(['submit', 'approve', 'dispute', 'cancel'])('%s: reaches finance-visible users of that project only, with the id only', async (action) => {
    const invoice = await createTestInvoice(world.companyId, world.p1, { status: action === 'approve' ? 'submitted' : 'draft' });
    const res = await app.inject({
      method: 'POST', url: `/api/v1/invoices/${invoice.id}/${action}`, headers: auth(world.users.admin),
      payload: action === 'dispute' ? { notes: 'n' } : {},
    });
    expect(res.statusCode).toBe(200);
    expect(await receiversOf('invoice_updated')).toEqual(['admin', 'fin', 'pmFin'].sort());
    expect(payloadsOf('fin', 'invoice_updated')).toEqual([{ invoiceId: invoice.id }]);
  });

  it('an invoice on another project reaches that project\'s finance manager instead', async () => {
    const invoice = await createTestInvoice(world.companyId, world.p2);
    const res = await app.inject({ method: 'POST', url: `/api/v1/invoices/${invoice.id}/submit`, headers: auth(world.users.admin), payload: {} });
    expect(res.statusCode).toBe(200);
    expect(await receiversOf('invoice_updated')).toEqual(['admin', 'fin', 'pm2Fin'].sort());
  });
});

// ─── Never delivered ─────────────────────────────────────────────────────────

describe('never delivered', () => {
  it('ended, deactivated and removed users and users outside the project receive nothing', async () => {
    await createDelivery(world.users.admin, world.p1, world.s1);
    await app.inject({
      method: 'POST', url: `/api/v1/projects/${world.p1}/instructions`, headers: auth(world.users.admin),
      payload: { type: 'instruction', title: 'x', issuedDate: '2026-11-20' },
    });
    const invoice = await createTestInvoice(world.companyId, world.p1);
    await app.inject({ method: 'POST', url: `/api/v1/invoices/${invoice.id}/submit`, headers: auth(world.users.admin), payload: {} });
    await liveUpdatesSettled();
    for (const name of ['ended', 'inactive', 'removedPm', 'viewerOut', 'worker1', 'ctr2', 'pm2Fin']) {
      expect({ name, types: (received.get(name) ?? []).map((e) => e.type) }).toEqual({ name, types: [] });
    }
  });

  it('another company never receives an event, and its own events stay inside it', async () => {
    await createDelivery(world.users.admin, world.p1, world.s1);
    await liveUpdatesSettled();
    expect(received.get('adminB')).toEqual([]);

    const bDelivery = await createDelivery(world.b.admin, world.b.project, world.b.site);
    const got = await receiversOf('delivery_created');
    expect(payloadsOf('adminB', 'delivery_created')).toEqual([{ deliveryId: bDelivery, projectId: world.b.project, siteId: world.b.site }]);
    for (const name of ALL().filter((n) => n !== 'adminB')) {
      expect(payloadsOf(name, 'delivery_created').map((p) => p['deliveryId'])).not.toContain(bDelivery);
    }
    expect(got).toContain('adminB');
  });

  it('a connection registered under one company with another company\'s token receives nothing', async () => {
    const writes: string[] = [];
    const session = app.jwt.verify<JwtPayload>(world.b.admin.accessToken);
    const stray: Client = { id: randomUUID(), userId: world.b.admin.id, companyId: world.companyId, session, write: (l) => writes.push(l) };
    registerClient(stray);
    clients.push(stray);
    await createDelivery(world.users.admin, world.p1, world.s1);
    await liveUpdatesSettled();
    expect(writes).toEqual([]);
  });
});
