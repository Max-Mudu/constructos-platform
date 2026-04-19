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
  createTestAttendanceRecord,
  clearDatabase,
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

beforeEach(async () => {
  await clearDatabase();
});

const BASE = (pid: string, sid: string) =>
  `/api/v1/projects/${pid}/sites/${sid}/attendance`;

// ─── POST — create ────────────────────────────────────────────────────────────

describe('POST /attendance', () => {
  it('site_supervisor can create attendance record for assigned site', async () => {
    const { company } = await createTestCompany(app, 'att-create-1');
    const admin = await createTestUser(app, company.id, 'company_admin', 'adm-ac1');
    const sup   = await createTestUser(app, company.id, 'site_supervisor', 'sup-ac1');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    await assignUserToProject(company.id, project.id, sup.id, site.id);
    const worker  = await createTestWorker(company.id);
    await assignWorkerToSite(company.id, project.id, site.id, worker.id, admin.id);

    const res = await app.inject({
      method: 'POST',
      url: BASE(project.id, site.id),
      headers: { authorization: `Bearer ${sup.accessToken}` },
      payload: {
        workerId:    worker.id,
        date:        '2026-04-07',
        status:      'present',
        checkInTime: '07:30',
        notes:       'On time',
      },
    });

    expect(res.statusCode).toBe(201);
    const { record } = res.json();
    expect(record.workerId).toBe(worker.id);
    expect(record.status).toBe('present');
    expect(record.checkInTime).toBe('07:30');
    expect(record.worker.firstName).toBe(worker.firstName);
  });

  it('company_admin can create attendance record', async () => {
    const { company, admin } = await createTestCompany(app, 'att-create-2');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    const worker  = await createTestWorker(company.id);
    await assignWorkerToSite(company.id, project.id, site.id, worker.id, admin.id);

    const res = await app.inject({
      method: 'POST',
      url: BASE(project.id, site.id),
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { workerId: worker.id, date: '2026-04-07', status: 'late' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().record.status).toBe('late');
  });

  it('supports all valid statuses: present, absent, late, half_day, excused', async () => {
    const { company, admin } = await createTestCompany(app, 'att-create-3');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);

    const statuses = ['present', 'absent', 'late', 'half_day', 'excused'] as const;
    for (let i = 0; i < statuses.length; i++) {
      const worker = await createTestWorker(company.id, { firstName: `Worker${i}` });
      await assignWorkerToSite(company.id, project.id, site.id, worker.id, admin.id);
      const res = await app.inject({
        method: 'POST',
        url: BASE(project.id, site.id),
        headers: { authorization: `Bearer ${admin.accessToken}` },
        payload: { workerId: worker.id, date: `2026-04-0${i + 1}`, status: statuses[i] },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().record.status).toBe(statuses[i]);
    }
  });

  it('rejects duplicate attendance for same worker/site/date — 403', async () => {
    const { company, admin } = await createTestCompany(app, 'att-create-4');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    const worker  = await createTestWorker(company.id);
    await assignWorkerToSite(company.id, project.id, site.id, worker.id, admin.id);
    await createTestAttendanceRecord(company.id, project.id, site.id, worker.id, admin.id);

    const res = await app.inject({
      method: 'POST',
      url: BASE(project.id, site.id),
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { workerId: worker.id, date: '2026-04-07', status: 'absent' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('site_supervisor on different site cannot create record — 404', async () => {
    const { company } = await createTestCompany(app, 'att-create-5');
    const admin  = await createTestUser(app, company.id, 'company_admin', 'adm-ac5');
    const sup    = await createTestUser(app, company.id, 'site_supervisor', 'sup-ac5');
    const project = await createTestProject(company.id);
    const siteA  = await createTestSite(company.id, project.id, 'Site A');
    const siteB  = await createTestSite(company.id, project.id, 'Site B');
    await assignUserToProject(company.id, project.id, sup.id, siteA.id);
    const worker = await createTestWorker(company.id);
    await assignWorkerToSite(company.id, project.id, siteB.id, worker.id, admin.id);

    const res = await app.inject({
      method: 'POST',
      url: BASE(project.id, siteB.id),
      headers: { authorization: `Bearer ${sup.accessToken}` },
      payload: { workerId: worker.id, date: '2026-04-07', status: 'present' },
    });

    expect(res.statusCode).toBe(404);
  });

  it('finance_officer cannot create attendance — 403', async () => {
    const { company } = await createTestCompany(app, 'att-create-6');
    const fo      = await createTestUser(app, company.id, 'finance_officer', 'fo-ac6');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);

    const res = await app.inject({
      method: 'POST',
      url: BASE(project.id, site.id),
      headers: { authorization: `Bearer ${fo.accessToken}` },
      payload: { workerId: '00000000-0000-0000-0000-000000000000', date: '2026-04-07', status: 'present' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('rejects worker not assigned to site — 403', async () => {
    const { company, admin } = await createTestCompany(app, 'att-create-7');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    const worker  = await createTestWorker(company.id);
    // worker NOT assigned

    const res = await app.inject({
      method: 'POST',
      url: BASE(project.id, site.id),
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { workerId: worker.id, date: '2026-04-07', status: 'present' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('rejects invalid status — 422', async () => {
    const { company, admin } = await createTestCompany(app, 'att-create-8');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    const worker  = await createTestWorker(company.id);
    await assignWorkerToSite(company.id, project.id, site.id, worker.id, admin.id);

    const res = await app.inject({
      method: 'POST',
      url: BASE(project.id, site.id),
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { workerId: worker.id, date: '2026-04-07', status: 'sick' }, // old enum value
    });

    expect(res.statusCode).toBe(422);
  });

  it('writes audit log on create', async () => {
    const { company, admin } = await createTestCompany(app, 'att-create-audit');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    const worker  = await createTestWorker(company.id);
    await assignWorkerToSite(company.id, project.id, site.id, worker.id, admin.id);

    const res = await app.inject({
      method: 'POST',
      url: BASE(project.id, site.id),
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { workerId: worker.id, date: '2026-04-07', status: 'present' },
    });

    const recordId = res.json().record.id;
    const log = await prisma.auditLog.findFirst({
      where: { action: 'create', entityType: 'attendance_record', entityId: recordId },
    });
    expect(log).toBeTruthy();
  });
});

// ─── GET list ─────────────────────────────────────────────────────────────────

describe('GET /attendance', () => {
  it('lists records for site', async () => {
    const { company, admin } = await createTestCompany(app, 'att-list-1');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    const wA      = await createTestWorker(company.id, { firstName: 'A' });
    const wB      = await createTestWorker(company.id, { firstName: 'B' });
    await assignWorkerToSite(company.id, project.id, site.id, wA.id, admin.id);
    await assignWorkerToSite(company.id, project.id, site.id, wB.id, admin.id);
    await createTestAttendanceRecord(company.id, project.id, site.id, wA.id, admin.id, { date: new Date('2026-04-07') });
    await createTestAttendanceRecord(company.id, project.id, site.id, wB.id, admin.id, { date: new Date('2026-04-07'), status: 'absent' });

    const res = await app.inject({
      method: 'GET',
      url: BASE(project.id, site.id),
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().records).toHaveLength(2);
  });

  it('filters by date', async () => {
    const { company, admin } = await createTestCompany(app, 'att-list-2');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    const wA      = await createTestWorker(company.id, { firstName: 'A' });
    const wB      = await createTestWorker(company.id, { firstName: 'B' });
    await assignWorkerToSite(company.id, project.id, site.id, wA.id, admin.id);
    await assignWorkerToSite(company.id, project.id, site.id, wB.id, admin.id);
    await createTestAttendanceRecord(company.id, project.id, site.id, wA.id, admin.id, { date: new Date('2026-04-07') });
    await createTestAttendanceRecord(company.id, project.id, site.id, wB.id, admin.id, { date: new Date('2026-04-08') });

    const res = await app.inject({
      method: 'GET',
      url: `${BASE(project.id, site.id)}?date=2026-04-07`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().records).toHaveLength(1);
  });

  it('filters by status', async () => {
    const { company, admin } = await createTestCompany(app, 'att-list-3');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    const wA      = await createTestWorker(company.id, { firstName: 'A' });
    const wB      = await createTestWorker(company.id, { firstName: 'B' });
    await assignWorkerToSite(company.id, project.id, site.id, wA.id, admin.id);
    await assignWorkerToSite(company.id, project.id, site.id, wB.id, admin.id);
    await createTestAttendanceRecord(company.id, project.id, site.id, wA.id, admin.id, { status: 'present' });
    await createTestAttendanceRecord(company.id, project.id, site.id, wB.id, admin.id, { status: 'absent', date: new Date('2026-04-08') });

    const res = await app.inject({
      method: 'GET',
      url: `${BASE(project.id, site.id)}?status=absent`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().records).toHaveLength(1);
    expect(res.json().records[0].status).toBe('absent');
  });

  it('does not leak records from another company', async () => {
    const { company: c1, admin: a1 } = await createTestCompany(app, 'att-list-4a');
    const { company: c2, admin: a2 } = await createTestCompany(app, 'att-list-4b');
    const p1 = await createTestProject(c1.id);
    const p2 = await createTestProject(c2.id);
    const s1 = await createTestSite(c1.id, p1.id);
    const s2 = await createTestSite(c2.id, p2.id);
    const w2 = await createTestWorker(c2.id);
    await assignWorkerToSite(c2.id, p2.id, s2.id, w2.id, a2.id);
    await createTestAttendanceRecord(c2.id, p2.id, s2.id, w2.id, a2.id);

    const res = await app.inject({
      method: 'GET',
      url: BASE(p1.id, s1.id),
      headers: { authorization: `Bearer ${a1.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().records).toHaveLength(0);
  });

  it('site_supervisor cannot see records for different site — 404', async () => {
    const { company } = await createTestCompany(app, 'att-list-5');
    const admin  = await createTestUser(app, company.id, 'company_admin', 'adm-al5');
    const sup    = await createTestUser(app, company.id, 'site_supervisor', 'sup-al5');
    const project = await createTestProject(company.id);
    const siteA  = await createTestSite(company.id, project.id, 'Site A');
    const siteB  = await createTestSite(company.id, project.id, 'Site B');
    await assignUserToProject(company.id, project.id, sup.id, siteA.id);
    const worker = await createTestWorker(company.id);
    await assignWorkerToSite(company.id, project.id, siteB.id, worker.id, admin.id);
    await createTestAttendanceRecord(company.id, project.id, siteB.id, worker.id, admin.id);

    const res = await app.inject({
      method: 'GET',
      url: BASE(project.id, siteB.id),
      headers: { authorization: `Bearer ${sup.accessToken}` },
    });

    expect(res.statusCode).toBe(404);
  });
});

// ─── GET /summary ─────────────────────────────────────────────────────────────

describe('GET /attendance/summary', () => {
  it('returns correct summary counts', async () => {
    const { company, admin } = await createTestCompany(app, 'att-summary-1');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    const statuses = ['present', 'present', 'absent', 'late', 'half_day', 'excused'] as const;
    for (let i = 0; i < statuses.length; i++) {
      const w = await createTestWorker(company.id, { firstName: `W${i}` });
      await assignWorkerToSite(company.id, project.id, site.id, w.id, admin.id);
      await createTestAttendanceRecord(company.id, project.id, site.id, w.id, admin.id, {
        status: statuses[i],
        date: new Date('2026-04-07'),
      });
    }

    const res = await app.inject({
      method: 'GET',
      url: `${BASE(project.id, site.id)}/summary?date=2026-04-07`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    const { summary } = res.json();
    expect(summary.total).toBe(6);
    expect(summary.present).toBe(2);
    expect(summary.absent).toBe(1);
    expect(summary.late).toBe(1);
    expect(summary.half_day).toBe(1);
    expect(summary.excused).toBe(1);
  });
});

// ─── GET single ───────────────────────────────────────────────────────────────

describe('GET /attendance/:recordId', () => {
  it('returns record with worker details', async () => {
    const { company, admin } = await createTestCompany(app, 'att-get-1');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    const worker  = await createTestWorker(company.id, { firstName: 'Detail' });
    await assignWorkerToSite(company.id, project.id, site.id, worker.id, admin.id);
    const rec = await createTestAttendanceRecord(company.id, project.id, site.id, worker.id, admin.id);

    const res = await app.inject({
      method: 'GET',
      url: `${BASE(project.id, site.id)}/${rec.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    const { record } = res.json();
    expect(record.worker.firstName).toBe('Detail');
    expect(record.recordedBy.id).toBe(admin.id);
  });

  it('returns 404 for non-existent record', async () => {
    const { company, admin } = await createTestCompany(app, 'att-get-2');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);

    const res = await app.inject({
      method: 'GET',
      url: `${BASE(project.id, site.id)}/00000000-0000-0000-0000-000000000000`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(404);
  });
});

// ─── PATCH ────────────────────────────────────────────────────────────────────

describe('PATCH /attendance/:recordId', () => {
  it('updates status and notes', async () => {
    const { company, admin } = await createTestCompany(app, 'att-update-1');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    const worker  = await createTestWorker(company.id);
    await assignWorkerToSite(company.id, project.id, site.id, worker.id, admin.id);
    const rec = await createTestAttendanceRecord(company.id, project.id, site.id, worker.id, admin.id);

    const res = await app.inject({
      method: 'PATCH',
      url: `${BASE(project.id, site.id)}/${rec.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { status: 'half_day', notes: 'Left early' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().record.status).toBe('half_day');
    expect(res.json().record.notes).toBe('Left early');
  });

  it('finance_officer cannot update — 403', async () => {
    const { company } = await createTestCompany(app, 'att-update-2');
    const admin  = await createTestUser(app, company.id, 'company_admin', 'adm-au2');
    const fo     = await createTestUser(app, company.id, 'finance_officer', 'fo-au2');
    const project = await createTestProject(company.id);
    const site   = await createTestSite(company.id, project.id);
    const worker = await createTestWorker(company.id);
    await assignWorkerToSite(company.id, project.id, site.id, worker.id, admin.id);
    const rec = await createTestAttendanceRecord(company.id, project.id, site.id, worker.id, admin.id);

    const res = await app.inject({
      method: 'PATCH',
      url: `${BASE(project.id, site.id)}/${rec.id}`,
      headers: { authorization: `Bearer ${fo.accessToken}` },
      payload: { status: 'absent' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('writes audit log on update', async () => {
    const { company, admin } = await createTestCompany(app, 'att-update-audit');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    const worker  = await createTestWorker(company.id);
    await assignWorkerToSite(company.id, project.id, site.id, worker.id, admin.id);
    const rec = await createTestAttendanceRecord(company.id, project.id, site.id, worker.id, admin.id);

    await app.inject({
      method: 'PATCH',
      url: `${BASE(project.id, site.id)}/${rec.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { notes: 'Updated' },
    });

    const log = await prisma.auditLog.findFirst({
      where: { action: 'update', entityType: 'attendance_record', entityId: rec.id },
    });
    expect(log).toBeTruthy();
  });
});

// ─── DELETE ───────────────────────────────────────────────────────────────────

describe('DELETE /attendance/:recordId', () => {
  it('company_admin can delete a record', async () => {
    const { company, admin } = await createTestCompany(app, 'att-delete-1');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    const worker  = await createTestWorker(company.id);
    await assignWorkerToSite(company.id, project.id, site.id, worker.id, admin.id);
    const rec = await createTestAttendanceRecord(company.id, project.id, site.id, worker.id, admin.id);

    const res = await app.inject({
      method: 'DELETE',
      url: `${BASE(project.id, site.id)}/${rec.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(204);
    const check = await prisma.attendanceRecord.findUnique({ where: { id: rec.id } });
    expect(check).toBeNull();
  });

  it('site_supervisor cannot delete — 403', async () => {
    const { company } = await createTestCompany(app, 'att-delete-2');
    const admin   = await createTestUser(app, company.id, 'company_admin', 'adm-ad2');
    const sup     = await createTestUser(app, company.id, 'site_supervisor', 'sup-ad2');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    await assignUserToProject(company.id, project.id, sup.id, site.id);
    const worker  = await createTestWorker(company.id);
    await assignWorkerToSite(company.id, project.id, site.id, worker.id, admin.id);
    const rec = await createTestAttendanceRecord(company.id, project.id, site.id, worker.id, admin.id);

    const res = await app.inject({
      method: 'DELETE',
      url: `${BASE(project.id, site.id)}/${rec.id}`,
      headers: { authorization: `Bearer ${sup.accessToken}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('writes audit log on delete', async () => {
    const { company, admin } = await createTestCompany(app, 'att-delete-audit');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    const worker  = await createTestWorker(company.id);
    await assignWorkerToSite(company.id, project.id, site.id, worker.id, admin.id);
    const rec = await createTestAttendanceRecord(company.id, project.id, site.id, worker.id, admin.id);

    await app.inject({
      method: 'DELETE',
      url: `${BASE(project.id, site.id)}/${rec.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    const log = await prisma.auditLog.findFirst({
      where: { action: 'delete', entityType: 'attendance_record', entityId: rec.id },
    });
    expect(log).toBeTruthy();
  });
});
