/**
 * Pilot mobile journeys — the workflows field users run on Android and iOS,
 * driven through the real HTTP API with the exact request shapes the mobile
 * client (packages/mobile/src/api/*.ts and the (tabs) screens) sends, and
 * asserting the response fields those screens read.
 *
 *   (a) site_supervisor: login -> /auth/me -> My Day -> attendance -> labour
 *       -> delivery + photo -> inspection
 *   (b) project_manager: deliveries, schedule tasks + work packages, task
 *       status update
 *   (c) consultant: drawings, issue an instruction
 *   (d) worker: only their own data
 *   (e) refresh-token rotation and logout the way the mobile client does it
 *       (tokens in the JSON body, no cookie jar, no bearer on /auth/refresh)
 *   cross-tenant: a company B supervisor cannot reach company A's site,
 *       delivery or attendance
 *
 * All data is synthetic and lives in the test database only.
 */
import { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import {
  assignUserToProject,
  assignWorkerToSite,
  buildMultipartFile,
  clearDatabase,
  createTestCompany,
  createTestContractor,
  createTestDrawing,
  createTestNotification,
  createTestProject,
  createTestRevision,
  createTestScheduleTask,
  createTestSite,
  createTestUser,
  createTestWorker,
  createTestWorkPackage,
  TestUser,
} from './helpers/fixtures';

const API = '/api/v1';
const PASSWORD = 'TestPass1'; // every fixture user's password (helpers/fixtures.ts)

// Minimal JPEG header: passes the upload magic-bytes check (same as delivery-files.test.ts).
const JPEG_BYTES = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46]);

// The mobile screens build dates as new Date().toISOString().split('T')[0].
const TODAY = new Date().toISOString().split('T')[0]!;

let app: FastifyInstance;

interface World {
  companyA: string;
  projectA: string;
  siteA1: string;          // the supervisor's (and worker's) site
  siteA2: string;          // same project, supervisor NOT assigned
  projectA2: string;       // same company, worker / supervisor not members
  sup: TestUser;
  pm: TestUser;
  consultant: TestUser;
  workerUser: TestUser;
  workerSelfId: string;    // Worker row linked to workerUser
  crewWorkerId: string;    // Worker without a login, on siteA1
  contractorId: string;
  workPackageId: string;
  taskId: string;
  drawingId: string;
  revisionId: string;
  supB: TestUser;
  projectB: string;
  siteB: string;
  crewWorkerBId: string;
}
let w: World;

// Artefacts created along the journeys (journeys run in file order).
let attendanceId = '';
let deliveryId = '';

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

/** POST /auth/login exactly as authApi.login does; returns the body. */
async function mobileLogin(email: string): Promise<{
  user: Record<string, unknown>; accessToken: string; refreshToken: string;
}> {
  const res = await app.inject({
    method: 'POST',
    url: `${API}/auth/login`,
    payload: { email: email.trim().toLowerCase(), password: PASSWORD },
  });
  expect(res.statusCode).toBe(200);
  return res.json();
}

/** GET with query params the way axios serialises `{ params }` (undefined dropped). */
function get(token: string, url: string, query?: Record<string, string | number | undefined>) {
  const qs = query
    ? Object.entries(query)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&')
    : '';
  return app.inject({ method: 'GET', url: `${API}${url}${qs ? `?${qs}` : ''}`, headers: bearer(token) });
}

function send(token: string, method: 'POST' | 'PATCH', url: string, payload: object) {
  return app.inject({ method, url: `${API}${url}`, headers: bearer(token), payload });
}

function expectDenied(res: LightMyRequestResponse) {
  expect([403, 404]).toContain(res.statusCode);
}

/** The AuthUser fields the mobile auth store and screens read (src/types AuthUser). */
function expectAuthUser(user: Record<string, unknown>, expected: { id: string; role: string; companyId: string }) {
  expect(user).toEqual(expect.objectContaining({
    id: expected.id,
    role: expected.role,
    companyId: expected.companyId,
    email: expect.any(String),
    firstName: expect.any(String),
    lastName: expect.any(String),
    canViewFinance: expect.any(Boolean),
  }));
  expect(user).toHaveProperty('defaultProjectId');
  expect(user).toHaveProperty('defaultSiteId');
  expect(user).not.toHaveProperty('passwordHash');
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await clearDatabase();

  // ── Company A ──────────────────────────────────────────────────────────────
  const { company, admin } = await createTestCompany(app, 'pilot-mob-a');
  const projectA  = await createTestProject(company.id, 'Pilot Tower');
  const projectA2 = await createTestProject(company.id, 'Other Project');
  const siteA1    = await createTestSite(company.id, projectA.id, 'Block A');
  const siteA2    = await createTestSite(company.id, projectA.id, 'Block B');

  const sup        = await createTestUser(app, company.id, 'site_supervisor', 'pilot-sup');
  const pm         = await createTestUser(app, company.id, 'project_manager', 'pilot-pm');
  const consultant = await createTestUser(app, company.id, 'consultant',      'pilot-con');
  const workerUser = await createTestUser(app, company.id, 'worker',          'pilot-wrk');
  await assignUserToProject(company.id, projectA.id, sup.id, siteA1.id);
  await assignUserToProject(company.id, projectA.id, pm.id);
  await assignUserToProject(company.id, projectA.id, consultant.id);
  await assignUserToProject(company.id, projectA.id, workerUser.id, siteA1.id);

  const selfWorker = await createTestWorker(company.id, { firstName: 'Wanjiku', lastName: 'Self', trade: 'Mason' });
  await prisma.worker.update({ where: { id: selfWorker.id }, data: { userId: workerUser.id } });
  const crew = await createTestWorker(company.id, { firstName: 'Otieno', lastName: 'Crew', trade: 'Steel fixer' });
  await assignWorkerToSite(company.id, projectA.id, siteA1.id, selfWorker.id, admin.id);
  await assignWorkerToSite(company.id, projectA.id, siteA1.id, crew.id, admin.id);

  const contractor = await createTestContractor(company.id, 'Pilot Builders');
  const wp = await createTestWorkPackage(company.id, projectA.id, siteA1.id, contractor.id, admin.id, 'Ground floor slab');
  await prisma.workPackage.update({ where: { id: wp.id }, data: { area: 'Zone 1' } });
  const task = await createTestScheduleTask(company.id, projectA.id, siteA1.id, contractor.id, admin.id, wp.id, 'Fix slab rebar');

  const drawing  = await createTestDrawing(company.id, projectA.id, admin.id, { drawingNumber: 'PT-S-101', title: 'Slab layout' });
  const revision = await createTestRevision(drawing.id, company.id, admin.id, { revisionNumber: 'B', status: 'issued_for_construction' });
  await prisma.drawing.update({ where: { id: drawing.id }, data: { currentRevisionId: revision.id } });

  // ── Company B ──────────────────────────────────────────────────────────────
  const { company: companyB, admin: adminB } = await createTestCompany(app, 'pilot-mob-b');
  const projectB = await createTestProject(companyB.id, 'B Project');
  const siteB    = await createTestSite(companyB.id, projectB.id, 'B Site');
  const supB     = await createTestUser(app, companyB.id, 'site_supervisor', 'pilot-supb');
  await assignUserToProject(companyB.id, projectB.id, supB.id, siteB.id);
  const crewB = await createTestWorker(companyB.id, { firstName: 'Bee', lastName: 'Crew' });
  await assignWorkerToSite(companyB.id, projectB.id, siteB.id, crewB.id, adminB.id);

  w = {
    companyA: company.id,
    projectA: projectA.id,
    siteA1: siteA1.id,
    siteA2: siteA2.id,
    projectA2: projectA2.id,
    sup, pm, consultant, workerUser,
    workerSelfId: selfWorker.id,
    crewWorkerId: crew.id,
    contractorId: contractor.id,
    workPackageId: wp.id,
    taskId: task.id,
    drawingId: drawing.id,
    revisionId: revision.id,
    supB,
    projectB: projectB.id,
    siteB: siteB.id,
    crewWorkerBId: crewB.id,
  };
});

afterAll(async () => {
  await clearDatabase();
  await app.close();
  await prisma.$disconnect();
});

// ─── (a) Site supervisor ──────────────────────────────────────────────────────

describe('(a) site_supervisor pilot day', () => {
  let token = '';

  it('logs in with tokens in the body and loads /auth/me', async () => {
    const login = await mobileLogin(w.sup.email);
    expect(typeof login.accessToken).toBe('string');
    expect(typeof login.refreshToken).toBe('string');
    expectAuthUser(login.user, { id: w.sup.id, role: 'site_supervisor', companyId: w.companyA });
    token = login.accessToken;

    const me = await get(token, '/auth/me');
    expect(me.statusCode).toBe(200);
    expectAuthUser(me.json().user, { id: w.sup.id, role: 'site_supervisor', companyId: w.companyA });
  });

  it('loads My Day (unread count) and the dashboard stats', async () => {
    const count = await get(token, '/notifications/count');
    expect(count.statusCode).toBe(200);
    expect(typeof count.json().count).toBe('number');

    const dash = await get(token, '/dashboard');
    expect(dash.statusCode).toBe(200);
    const { stats } = dash.json();
    expect(stats.projects).toEqual(expect.objectContaining({ total: expect.any(Number), recent: expect.any(Array) }));
    expect(stats.workers).toEqual(expect.objectContaining({ total: expect.any(Number), active: expect.any(Number) }));
    expect(stats.attendance).toEqual(expect.objectContaining({ todayTotal: expect.any(Number), todayRate: expect.any(Number) }));
    expect(typeof stats.labour.thisWeekHours).toBe('number');
    expect(stats.deliveries).toEqual(expect.objectContaining({ thisMonthCount: expect.any(Number) }));
    expect(stats.instructions).toEqual(expect.objectContaining({ open: expect.any(Number) }));
    expect(typeof stats.notifications.unread).toBe('number');
    // Keys present for the dashboard's optional chaining; supervisor has no finance view.
    expect(stats).toHaveProperty('invoices');
    expect(stats).toHaveProperty('budget');
    expect(stats.finance ?? null).toBeNull();
  });

  it('picks the project and site the way the screens do', async () => {
    const projects = await get(token, '/projects');
    expect(projects.statusCode).toBe(200);
    const ids = projects.json().projects.map((p: { id: string }) => p.id);
    expect(ids).toContain(w.projectA);
    expect(ids).not.toContain(w.projectA2);

    const sites = await get(token, `/projects/${w.projectA}/sites`);
    expect(sites.statusCode).toBe(200);
    const site = sites.json().sites.find((s: { id: string }) => s.id === w.siteA1);
    expect(site).toEqual(expect.objectContaining({ id: w.siteA1, projectId: w.projectA, name: 'Block A' }));

    const one = await get(token, `/projects/${w.projectA}/sites/${w.siteA1}`);
    expect(one.statusCode).toBe(200);
    expect(one.json().site.id).toBe(w.siteA1);
  });

  it('records attendance for a crew worker on their site, then checks them out', async () => {
    const workers = await get(token, `/projects/${w.projectA}/sites/${w.siteA1}/workers`);
    expect(workers.statusCode).toBe(200);
    const crew = workers.json().workers.find((x: { id: string }) => x.id === w.crewWorkerId);
    expect(crew).toEqual(expect.objectContaining({ firstName: 'Otieno', lastName: 'Crew' }));

    // attendance.tsx record modal: { workerId, date, status, checkInTime?, notes? }
    const created = await send(token, 'POST', `/projects/${w.projectA}/sites/${w.siteA1}/attendance`, {
      workerId: w.crewWorkerId,
      date: TODAY,
      status: 'present',
      checkInTime: '07:30',
    });
    expect(created.statusCode).toBe(201);
    const { record } = created.json();
    expect(record).toEqual(expect.objectContaining({
      id: expect.any(String),
      workerId: w.crewWorkerId,
      projectId: w.projectA,
      siteId: w.siteA1,
      status: 'present',
      checkInTime: '07:30',
      checkOutTime: null,
    }));
    expect(record.worker).toEqual(expect.objectContaining({ id: w.crewWorkerId, firstName: 'Otieno', lastName: 'Crew' }));
    attendanceId = record.id;

    // attendance.tsx list: GET ...?date=
    const list = await get(token, `/projects/${w.projectA}/sites/${w.siteA1}/attendance`, { date: TODAY });
    expect(list.statusCode).toBe(200);
    const listed = list.json().records.find((r: { id: string }) => r.id === attendanceId);
    expect(listed).toBeDefined();
    expect(listed.worker.firstName).toBe('Otieno');

    // check-out: PATCH { checkOutTime }
    const out = await send(token, 'PATCH', `/projects/${w.projectA}/sites/${w.siteA1}/attendance/${attendanceId}`, {
      checkOutTime: '17:00',
    });
    expect(out.statusCode).toBe(200);
    expect(out.json().record.checkOutTime).toBe('17:00');
  });

  it('cannot record attendance on a site of the project they are not assigned to', async () => {
    const res = await send(token, 'POST', `/projects/${w.projectA}/sites/${w.siteA2}/attendance`, {
      workerId: w.crewWorkerId, date: TODAY, status: 'present',
    });
    expectDenied(res);
  });

  it('logs labour without wage fields and sees it in the labour list', async () => {
    const workers = await get(token, '/workers');
    expect(workers.statusCode).toBe(200);
    expect(workers.json().workers.map((x: { id: string }) => x.id)).toContain(w.crewWorkerId);

    // labour.tsx: { workerId, date, hoursWorked, notes } — no dailyRate for a supervisor
    const created = await send(token, 'POST', `/projects/${w.projectA}/sites/${w.siteA1}/labour`, {
      workerId: w.crewWorkerId,
      date: TODAY,
      hoursWorked: 9.5,
      notes: 'Slab rebar',
    });
    expect(created.statusCode).toBe(201);
    const { entry } = created.json();
    expect(entry).toEqual(expect.objectContaining({ id: expect.any(String), workerId: w.crewWorkerId, notes: 'Slab rebar' }));
    expect(Number(entry.hoursWorked)).toBe(9.5);
    expect(entry.worker.firstName).toBe('Otieno');
    expect(entry).not.toHaveProperty('dailyRate');

    // labour.tsx list: GET /labour?projectId&siteId&limit&offset&startDate&endDate
    const list = await get(token, '/labour', {
      projectId: w.projectA, siteId: w.siteA1, limit: 20, offset: 0, startDate: TODAY, endDate: TODAY,
    });
    expect(list.statusCode).toBe(200);
    const body = list.json();
    expect(body.financialFieldsIncluded).toBe(false);
    expect(body.pagination).toEqual(expect.objectContaining({ total: expect.any(Number), hasMore: expect.any(Boolean) }));
    const listed = body.entries.find((e: { id: string }) => e.id === entry.id);
    expect(listed).toBeDefined();
    expect(Number(listed.hoursWorked)).toBe(9.5);
    expect(listed.worker).toEqual(expect.objectContaining({ firstName: 'Otieno', lastName: 'Crew' }));
    expect(listed).not.toHaveProperty('dailyRate');
  });

  it('records a delivery with a photo and sees it in the deliveries list', async () => {
    // deliveries.tsx create payload (projectId/siteId go in the URL)
    const created = await send(token, 'POST', `/projects/${w.projectA}/sites/${w.siteA1}/deliveries`, {
      supplierName: 'Bamburi Cement',
      deliveryDate: TODAY,
      itemDescription: 'Cement 50kg',
      quantityOrdered: 200,
      quantityDelivered: 180,
      unitOfMeasure: 'bags',
      conditionOnArrival: 'good',
      receivedById: w.sup.id,
      comments: '20 bags short',
    });
    expect(created.statusCode).toBe(201);
    const { delivery } = created.json();
    expect(delivery).toEqual(expect.objectContaining({
      id: expect.any(String), projectId: w.projectA, siteId: w.siteA1,
      supplierName: 'Bamburi Cement', inspectionStatus: 'pending',
    }));
    deliveryId = delivery.id;

    // deliveriesApi.uploadPhoto: multipart field "file"
    const { body, headers } = buildMultipartFile('site-photo.jpg', 'image/jpeg', JPEG_BYTES, 'file');
    const photo = await app.inject({
      method: 'POST',
      url: `${API}/projects/${w.projectA}/sites/${w.siteA1}/deliveries/${deliveryId}/photos`,
      headers: { ...bearer(token), ...headers },
      payload: body,
    });
    expect(photo.statusCode).toBe(201);

    // deliveriesApi.list: GET /deliveries?projectId&siteId&limit&offset
    const list = await get(token, '/deliveries', { projectId: w.projectA, siteId: w.siteA1, limit: 20, offset: 0 });
    expect(list.statusCode).toBe(200);
    const listBody = list.json();
    expect(listBody.pagination).toEqual(expect.objectContaining({ total: expect.any(Number), hasMore: expect.any(Boolean) }));
    const listed = listBody.records.find((r: { id: string }) => r.id === deliveryId);
    expect(listed).toEqual(expect.objectContaining({
      supplierName: 'Bamburi Cement',
      itemDescription: 'Cement 50kg',
      unitOfMeasure: 'bags',
      conditionOnArrival: 'good',
      inspectionStatus: 'pending',
      comments: '20 bags short',
      projectId: w.projectA,
      siteId: w.siteA1,
    }));
    expect(Number(listed.quantityOrdered)).toBe(200);
    expect(Number(listed.quantityDelivered)).toBe(180);
    expect(listed.receivedBy).toEqual(expect.objectContaining({ id: w.sup.id, firstName: expect.any(String), lastName: expect.any(String) }));
    expect(listed.photos).toHaveLength(1);
    expect(listed.photos[0]).toEqual(expect.objectContaining({ id: expect.any(String), fileUrl: expect.any(String) }));
  });

  it('updates inspection and acceptance from the delivery detail screen', async () => {
    const res = await send(token, 'PATCH', `/projects/${w.projectA}/sites/${w.siteA1}/deliveries/${deliveryId}`, {
      inspectionStatus: 'passed',
      acceptanceStatus: 'partially_accepted',
      rejectionReason: null,
      discrepancyNotes: '20 bags short',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().delivery).toEqual(expect.objectContaining({
      id: deliveryId, inspectionStatus: 'passed', acceptanceStatus: 'partially_accepted', discrepancyNotes: '20 bags short',
    }));
  });
});

// ─── (b) Project manager ──────────────────────────────────────────────────────

describe('(b) project_manager views site work and updates a task', () => {
  let token = '';

  beforeAll(async () => {
    token = (await mobileLogin(w.pm.email)).accessToken;
  });

  it('sees the supervisor delivery (with photo) in the deliveries list', async () => {
    const res = await get(token, '/deliveries', { projectId: w.projectA, siteId: w.siteA1, limit: 20, offset: 0 });
    expect(res.statusCode).toBe(200);
    const listed = res.json().records.find((r: { id: string }) => r.id === deliveryId);
    expect(listed).toBeDefined();
    expect(listed.acceptanceStatus).toBe('partially_accepted');
    expect(listed.photos).toHaveLength(1);
  });

  it('loads schedule tasks with contractor, work package and milestones', async () => {
    const res = await get(token, `/projects/${w.projectA}/sites/${w.siteA1}/schedule/tasks`);
    expect(res.statusCode).toBe(200);
    const task = res.json().tasks.find((t: { id: string }) => t.id === w.taskId);
    expect(task).toEqual(expect.objectContaining({
      id: w.taskId,
      projectId: w.projectA,
      siteId: w.siteA1,
      title: 'Fix slab rebar',
      status: 'not_started',
      workPackageId: w.workPackageId,
    }));
    expect(task.contractor).toEqual(expect.objectContaining({ id: w.contractorId, name: 'Pilot Builders' }));
    expect(task.workPackage).toEqual({ id: w.workPackageId, name: 'Ground floor slab', area: 'Zone 1' });
    expect(Array.isArray(task.milestones)).toBe(true);
  });

  it('lists the site work packages', async () => {
    const res = await get(token, `/projects/${w.projectA}/sites/${w.siteA1}/schedule/packages`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const packages = body.packages ?? body.workPackages;
    expect(Array.isArray(packages)).toBe(true);
    expect(packages.map((p: { id: string }) => p.id)).toContain(w.workPackageId);
  });

  it('updates task status and progress with the schedule screen payload', async () => {
    const url = `/projects/${w.projectA}/sites/${w.siteA1}/schedule/tasks/${w.taskId}`;
    // schedule.tsx update modal always sends every field, nulls included
    const res = await send(token, 'PATCH', url, {
      status: 'in_progress',
      actualProgress: 40,
      actualStartDate: TODAY,
      actualEndDate: null,
      delayReason: null,
      comments: null,
    });
    expect(res.statusCode).toBe(200);
    const { task } = res.json();
    expect(task.status).toBe('in_progress');
    expect(Number(task.actualProgress)).toBe(40);

    const delayed = await send(token, 'PATCH', url, {
      status: 'delayed',
      actualProgress: 40,
      actualStartDate: TODAY,
      actualEndDate: null,
      delayReason: 'Rebar delivery late',
      comments: 'Waiting on supplier',
    });
    expect(delayed.statusCode).toBe(200);
    expect(delayed.json().task).toEqual(expect.objectContaining({ status: 'delayed', delayReason: 'Rebar delivery late' }));

    const activity = await get(token, `${url}/activity`);
    expect(activity.statusCode).toBe(200);
    const activities = activity.json().activities as Array<{ type: string; user: { firstName: string } }>;
    expect(activities.some((a) => a.type === 'status_change')).toBe(true);
    expect(activities[0]!.user).toEqual(expect.objectContaining({ firstName: expect.any(String) }));
  });

  it('a site supervisor can also update task progress on their site', async () => {
    const supToken = (await mobileLogin(w.sup.email)).accessToken;
    const res = await send(supToken, 'PATCH', `/projects/${w.projectA}/sites/${w.siteA1}/schedule/tasks/${w.taskId}`, {
      status: 'in_progress', actualProgress: 55, actualStartDate: TODAY, actualEndDate: null, delayReason: null, comments: null,
    });
    expect(res.statusCode).toBe(200);
    expect(Number(res.json().task.actualProgress)).toBe(55);
  });
});

// ─── (c) Consultant ───────────────────────────────────────────────────────────

describe('(c) consultant views drawings and issues an instruction', () => {
  let token = '';
  let instructionId = '';

  beforeAll(async () => {
    token = (await mobileLogin(w.consultant.email)).accessToken;
  });

  it('lists drawings with the fields drawingsApi.normalize needs', async () => {
    const res = await get(token, `/projects/${w.projectA}/drawings`);
    expect(res.statusCode).toBe(200);
    const drawing = res.json().drawings.find((d: { id: string }) => d.id === w.drawingId);
    expect(drawing).toEqual(expect.objectContaining({
      id: w.drawingId, projectId: w.projectA, drawingNumber: 'PT-S-101', title: 'Slab layout',
      currentRevisionId: w.revisionId,
    }));
    const latest = drawing.revisions.find((r: { id: string }) => r.id === drawing.currentRevisionId);
    expect(latest).toEqual(expect.objectContaining({
      revisionNumber: 'B', status: 'issued_for_construction', fileUrl: expect.any(String), fileName: expect.any(String),
    }));

    const one = await get(token, `/projects/${w.projectA}/drawings/${w.drawingId}`);
    expect(one.statusCode).toBe(200);
    expect(one.json().drawing.revisions.length).toBeGreaterThan(0);
  });

  it('issues an instruction with the projects screen payload', async () => {
    const res = await send(token, 'POST', `/projects/${w.projectA}/instructions`, {
      type: 'instruction',
      title: 'Increase slab cover to 40mm',
      priority: 'high',
      issuedDate: TODAY,
      description: 'Per revised structural note',
    });
    expect(res.statusCode).toBe(201);
    const { instruction } = res.json();
    expect(instruction).toEqual(expect.objectContaining({
      id: expect.any(String), projectId: w.projectA, type: 'instruction', title: 'Increase slab cover to 40mm',
      priority: 'high', status: 'open', description: 'Per revised structural note',
    }));
    expect(instruction.issuedBy).toEqual(expect.objectContaining({ id: w.consultant.id, firstName: expect.any(String), lastName: expect.any(String) }));
    instructionId = instruction.id;

    const list = await get(token, `/projects/${w.projectA}/instructions`);
    expect(list.statusCode).toBe(200);
    const listed = list.json().instructions.find((i: { id: string }) => i.id === instructionId);
    expect(listed.issuedBy.id).toBe(w.consultant.id);
  });

  it('the project manager acknowledges it from the instruction detail', async () => {
    const pmToken = (await mobileLogin(w.pm.email)).accessToken;
    const res = await send(pmToken, 'PATCH', `/projects/${w.projectA}/instructions/${instructionId}`, {
      status: 'acknowledged', resolutionNotes: undefined,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().instruction.status).toBe('acknowledged');
  });

  it('cannot record site data (attendance, deliveries)', async () => {
    expectDenied(await send(token, 'POST', `/projects/${w.projectA}/sites/${w.siteA1}/attendance`, {
      workerId: w.crewWorkerId, date: TODAY, status: 'present',
    }));
    expectDenied(await send(token, 'POST', `/projects/${w.projectA}/sites/${w.siteA1}/deliveries`, {
      supplierName: 'X', deliveryDate: TODAY, itemDescription: 'Y', quantityOrdered: 1, quantityDelivered: 1,
      unitOfMeasure: 'u', conditionOnArrival: 'good', receivedById: w.consultant.id,
    }));
  });
});

// ─── (d) Worker ───────────────────────────────────────────────────────────────

describe('(d) worker sees only their own data', () => {
  let token = '';

  beforeAll(async () => {
    const login = await mobileLogin(w.workerUser.email);
    expectAuthUser(login.user, { id: w.workerUser.id, role: 'worker', companyId: w.companyA });
    token = login.accessToken;
  });

  it('sees only the project they belong to', async () => {
    const res = await get(token, '/projects');
    expect(res.statusCode).toBe(200);
    const ids = res.json().projects.map((p: { id: string }) => p.id);
    expect(ids).toEqual([w.projectA]);
    expectDenied(await get(token, `/projects/${w.projectA2}`));
  });

  it('checks themselves in (idempotent) on their assigned site only', async () => {
    const url = `/projects/${w.projectA}/sites/${w.siteA1}/attendance/self`;
    const first = await send(token, 'POST', url, { checkInTime: '07:15' });
    expect(first.statusCode).toBe(201);
    const { record } = first.json();
    expect(record).toEqual(expect.objectContaining({
      workerId: w.workerSelfId, siteId: w.siteA1, status: 'present', checkInTime: '07:15',
    }));

    // attendance.tsx sends {} when no time is chosen
    const again = await send(token, 'POST', url, {});
    expect(again.statusCode).toBe(201);
    expect(again.json().record.id).toBe(record.id);
    expect(await prisma.attendanceRecord.count({ where: { workerId: w.workerSelfId } })).toBe(1);

    const otherSite = await send(token, 'POST', `/projects/${w.projectA}/sites/${w.siteA2}/attendance/self`, {});
    expectDenied(otherSite);
  });

  it('cannot read other people\'s attendance, labour, deliveries or the worker list', async () => {
    expectDenied(await get(token, `/projects/${w.projectA}/sites/${w.siteA1}/attendance`, { date: TODAY }));
    expectDenied(await get(token, `/projects/${w.projectA}/sites/${w.siteA1}/attendance/${attendanceId}`));
    expectDenied(await get(token, '/labour', { projectId: w.projectA, siteId: w.siteA1 }));
    expectDenied(await get(token, '/deliveries', { projectId: w.projectA, siteId: w.siteA1 }));
    expectDenied(await get(token, '/workers'));
    expectDenied(await get(token, `/projects/${w.projectA}/sites/${w.siteA1}/workers`));
  });

  it('cannot record attendance for anyone else', async () => {
    expectDenied(await send(token, 'POST', `/projects/${w.projectA}/sites/${w.siteA1}/attendance`, {
      workerId: w.crewWorkerId, date: TODAY, status: 'absent',
    }));
  });

  it('sees only their own notifications', async () => {
    await createTestNotification(w.companyA, w.workerUser.id, { title: 'Your shift' });
    await createTestNotification(w.companyA, w.sup.id, { title: 'Supervisor only' });

    const res = await get(token, '/notifications', { limit: 50 });
    expect(res.statusCode).toBe(200);
    const { notifications } = res.json() as { notifications: Array<{ userId: string; title: string }> };
    expect(notifications.length).toBeGreaterThan(0);
    expect(notifications.every((n) => n.userId === w.workerUser.id)).toBe(true);

    const count = await get(token, '/notifications/count');
    expect(count.json().count).toBe(notifications.length);
  });
});

// ─── (e) Refresh rotation and logout ──────────────────────────────────────────

describe('(e) refresh rotation and logout, mobile style', () => {
  /** client.ts refreshAccessToken: raw axios, body { refreshToken }, no bearer, no cookie jar. */
  function mobileRefresh(refreshToken: string) {
    return app.inject({ method: 'POST', url: `${API}/auth/refresh`, payload: { refreshToken } });
  }

  it('rotates on every refresh and the new access token works', async () => {
    const login = await mobileLogin(w.sup.email);

    const r1 = await mobileRefresh(login.refreshToken);
    expect(r1.statusCode).toBe(200);
    const t1 = r1.json();
    expect(typeof t1.accessToken).toBe('string');
    expect(typeof t1.refreshToken).toBe('string');
    expect(t1.refreshToken).not.toBe(login.refreshToken);

    const me = await get(t1.accessToken, '/auth/me');
    expect(me.statusCode).toBe(200);
    expect(me.json().user.id).toBe(w.sup.id);

    const r2 = await mobileRefresh(t1.refreshToken);
    expect(r2.statusCode).toBe(200);
    expect(r2.json().refreshToken).not.toBe(t1.refreshToken);
  });

  it('rejects a replayed (already rotated) refresh token with a status the client treats as session end', async () => {
    const login = await mobileLogin(w.pm.email);
    const r1 = await mobileRefresh(login.refreshToken);
    expect(r1.statusCode).toBe(200);

    const replay = await mobileRefresh(login.refreshToken);
    expect([400, 401, 403]).toContain(replay.statusCode);

    // Reuse revokes the session family: the rotated token is dead too.
    const after = await mobileRefresh(r1.json().refreshToken);
    expect([400, 401, 403]).toContain(after.statusCode);
  });

  it('a refresh with no token is a session end (401), not a server error', async () => {
    const res = await app.inject({ method: 'POST', url: `${API}/auth/refresh`, payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it('logout with bearer + body refreshToken revokes the refresh token', async () => {
    const login = await mobileLogin(w.consultant.email);
    const r1 = await mobileRefresh(login.refreshToken);
    const tokens = r1.json();

    const out = await app.inject({
      method: 'POST',
      url: `${API}/auth/logout`,
      headers: bearer(tokens.accessToken),
      payload: { refreshToken: tokens.refreshToken },
    });
    expect(out.statusCode).toBe(200);

    const refreshAfter = await mobileRefresh(tokens.refreshToken);
    expect([400, 401, 403]).toContain(refreshAfter.statusCode);
  });
});

// ─── Cross-tenant ─────────────────────────────────────────────────────────────

describe('cross-tenant: company B supervisor vs company A data', () => {
  let token = '';

  beforeAll(async () => {
    const login = await mobileLogin(w.supB.email);
    expectAuthUser(login.user, { id: w.supB.id, role: 'site_supervisor', companyId: w.supB.companyId });
    token = login.accessToken;
  });

  it('does not see company A projects', async () => {
    const res = await get(token, '/projects');
    expect(res.statusCode).toBe(200);
    const ids = res.json().projects.map((p: { id: string }) => p.id);
    expect(ids).not.toContain(w.projectA);
    expect(ids).toContain(w.projectB);
  });

  it('gets 403/404 on company A site, workers, delivery and attendance', async () => {
    const base = `/projects/${w.projectA}/sites/${w.siteA1}`;
    expectDenied(await get(token, `/projects/${w.projectA}`));
    expectDenied(await get(token, `/projects/${w.projectA}/sites`));
    expectDenied(await get(token, base));
    expectDenied(await get(token, `${base}/workers`));
    expectDenied(await get(token, `${base}/deliveries`));
    expectDenied(await get(token, `${base}/deliveries/${deliveryId}`));
    expectDenied(await get(token, `${base}/attendance`, { date: TODAY }));
    expectDenied(await get(token, `${base}/attendance/${attendanceId}`));
    expectDenied(await get(token, '/deliveries', { projectId: w.projectA, siteId: w.siteA1, limit: 20, offset: 0 }));
    expectDenied(await get(token, '/labour', { projectId: w.projectA, siteId: w.siteA1, limit: 20, offset: 0 }));
    expectDenied(await get(token, `${base}/schedule/tasks`));
  });

  it('cannot write to company A delivery or attendance', async () => {
    const base = `/projects/${w.projectA}/sites/${w.siteA1}`;
    expectDenied(await send(token, 'PATCH', `${base}/deliveries/${deliveryId}`, { inspectionStatus: 'failed' }));
    expectDenied(await send(token, 'PATCH', `${base}/attendance/${attendanceId}`, { checkOutTime: '12:00' }));
    expectDenied(await send(token, 'POST', `${base}/attendance`, { workerId: w.crewWorkerId, date: TODAY, status: 'absent' }));

    const { body, headers } = buildMultipartFile('x.jpg', 'image/jpeg', JPEG_BYTES, 'file');
    const photo = await app.inject({
      method: 'POST',
      url: `${API}${base}/deliveries/${deliveryId}/photos`,
      headers: { ...bearer(token), ...headers },
      payload: body,
    });
    expectDenied(photo);

    // Company A rows are untouched.
    const delivery = await prisma.deliveryRecord.findUnique({ where: { id: deliveryId }, select: { inspectionStatus: true } });
    expect(delivery?.inspectionStatus).toBe('passed');
    const att = await prisma.attendanceRecord.findUnique({ where: { id: attendanceId }, select: { checkOutTime: true } });
    expect(att?.checkOutTime).toBe('17:00');
    expect(await prisma.deliveryPhoto.count({ where: { deliveryRecordId: deliveryId } })).toBe(1);
  });

  it('cannot use a company A worker on their own site', async () => {
    const res = await send(token, 'POST', `/projects/${w.projectB}/sites/${w.siteB}/attendance`, {
      workerId: w.crewWorkerId, date: TODAY, status: 'present',
    });
    expect([403, 404, 422]).toContain(res.statusCode);
    expect(await prisma.attendanceRecord.count({ where: { siteId: w.siteB } })).toBe(0);

    // Their own crew works normally (control for the denial above).
    const own = await send(token, 'POST', `/projects/${w.projectB}/sites/${w.siteB}/attendance`, {
      workerId: w.crewWorkerBId, date: TODAY, status: 'present',
    });
    expect(own.statusCode).toBe(201);
  });
});
