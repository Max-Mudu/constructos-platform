/**
 * A second labour entry or attendance record for the same worker, site and
 * day is answered with 409 and a clear message, never 500. The mobile offline
 * queue relies on this: when a replayed create meets an existing record it
 * reads that record back (site-scoped list filtered by date and worker) and
 * compares it with what it queued, to tell "my earlier send already landed"
 * from "a different entry already exists".
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

const LABOUR = (pid: string, sid: string) => `/api/v1/projects/${pid}/sites/${sid}/labour`;
const ATTENDANCE = (pid: string, sid: string) => `/api/v1/projects/${pid}/sites/${sid}/attendance`;

async function siteWithSupervisor(slug: string) {
  const { company, admin } = await createTestCompany(app, slug);
  const sup     = await createTestUser(app, company.id, 'site_supervisor', `sup-${slug}`);
  const project = await createTestProject(company.id);
  const site    = await createTestSite(company.id, project.id);
  await assignUserToProject(company.id, project.id, sup.id, site.id);
  const worker  = await createTestWorker(company.id);
  await assignWorkerToSite(company.id, project.id, site.id, worker.id, admin.id);
  return { company, admin, sup, project, site, worker };
}

// ─── Labour ───────────────────────────────────────────────────────────────────

describe('POST /labour — an entry already exists for the worker and day', () => {
  it('answers 409 LABOUR_ENTRY_EXISTS with a clear message and stores nothing new', async () => {
    const { company, admin, sup, project, site, worker } = await siteWithSupervisor('dup-lb-1');
    await createTestLabourEntry(company.id, project.id, site.id, worker.id, admin.id, {
      date: new Date('2026-11-20'),
    });

    const res = await app.inject({
      method: 'POST',
      url: LABOUR(project.id, site.id),
      headers: { authorization: `Bearer ${sup.accessToken}` },
      payload: { workerId: worker.id, date: '2026-11-20', hoursWorked: 6 },
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.code).toBe('LABOUR_ENTRY_EXISTS');
    expect(body.error).toBe('A labour entry already exists for this worker on this date');
    // No database detail leaks into the answer.
    expect(JSON.stringify(body)).not.toMatch(/P2002|Unique constraint|prisma/i);

    const rows = await prisma.labourEntry.findMany({ where: { siteId: site.id, workerId: worker.id } });
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.hoursWorked)).toBe(8); // the existing entry is untouched
  });

  it('two simultaneous creates for the same worker and day: one 201, one 409, one row', async () => {
    const { sup, project, site, worker } = await siteWithSupervisor('dup-lb-2');
    const send = () => app.inject({
      method: 'POST',
      url: LABOUR(project.id, site.id),
      headers: { authorization: `Bearer ${sup.accessToken}` },
      payload: { workerId: worker.id, date: '2026-11-21', hoursWorked: 8, notes: 'replay' },
    });

    const results = await Promise.all([send(), send()]);
    const statuses = results.map((r) => r.statusCode).sort();
    expect(statuses).toEqual([201, 409]);
    const conflict = results.find((r) => r.statusCode === 409)!;
    expect(conflict.json().code).toBe('LABOUR_ENTRY_EXISTS');

    expect(await prisma.labourEntry.count({ where: { siteId: site.id, workerId: worker.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityType: 'labour_entry', action: 'create' } })).toBe(1);
  });

  it('the same worker on another day is still accepted', async () => {
    const { company, admin, sup, project, site, worker } = await siteWithSupervisor('dup-lb-3');
    await createTestLabourEntry(company.id, project.id, site.id, worker.id, admin.id, {
      date: new Date('2026-11-20'),
    });
    const res = await app.inject({
      method: 'POST',
      url: LABOUR(project.id, site.id),
      headers: { authorization: `Bearer ${sup.accessToken}` },
      payload: { workerId: worker.id, date: '2026-11-22', hoursWorked: 8 },
    });
    expect(res.statusCode).toBe(201);
  });

  it('the site list filtered by date and worker returns the fields the mobile queue compares', async () => {
    const { sup, project, site, worker } = await siteWithSupervisor('dup-lb-4');
    const created = await app.inject({
      method: 'POST',
      url: LABOUR(project.id, site.id),
      headers: { authorization: `Bearer ${sup.accessToken}` },
      payload: { workerId: worker.id, date: '2026-11-23', hoursWorked: 7.5, notes: 'queued offline' },
    });
    expect(created.statusCode).toBe(201);

    const list = await app.inject({
      method: 'GET',
      url: `${LABOUR(project.id, site.id)}?date=2026-11-23&workerId=${worker.id}`,
      headers: { authorization: `Bearer ${sup.accessToken}` },
    });
    expect(list.statusCode).toBe(200);
    const { entries } = list.json();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id:             created.json().entry.id,
      workerId:       worker.id,
      registeredById: sup.id,
      notes:          'queued offline',
    });
    expect(Number(entries[0].hoursWorked)).toBe(7.5);
    expect(String(entries[0].date).slice(0, 10)).toBe('2026-11-23');
  });
});

// ─── Attendance ───────────────────────────────────────────────────────────────

describe('POST /attendance — a record already exists for the worker and day', () => {
  it('answers 409 ATTENDANCE_EXISTS with a clear message and stores nothing new', async () => {
    const { company, admin, sup, project, site, worker } = await siteWithSupervisor('dup-at-1');
    await createTestAttendanceRecord(company.id, project.id, site.id, worker.id, admin.id, {
      date: new Date('2026-11-20'), status: 'present',
    });

    const res = await app.inject({
      method: 'POST',
      url: ATTENDANCE(project.id, site.id),
      headers: { authorization: `Bearer ${sup.accessToken}` },
      payload: { workerId: worker.id, date: '2026-11-20', status: 'late' },
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.code).toBe('ATTENDANCE_EXISTS');
    expect(body.error).toBe('Attendance record already exists for this worker on this date');
    expect(JSON.stringify(body)).not.toMatch(/P2002|Unique constraint|prisma/i);

    const rows = await prisma.attendanceRecord.findMany({ where: { siteId: site.id, workerId: worker.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('present');
  });

  it('two simultaneous creates for the same worker and day: one 201, one 409, one row', async () => {
    const { sup, project, site, worker } = await siteWithSupervisor('dup-at-2');
    const send = () => app.inject({
      method: 'POST',
      url: ATTENDANCE(project.id, site.id),
      headers: { authorization: `Bearer ${sup.accessToken}` },
      payload: { workerId: worker.id, date: '2026-11-21', status: 'present', checkInTime: '07:30' },
    });

    const results = await Promise.all([send(), send()]);
    const statuses = results.map((r) => r.statusCode).sort();
    expect(statuses).toEqual([201, 409]);
    const conflict = results.find((r) => r.statusCode === 409)!;
    expect(conflict.json().code).toBe('ATTENDANCE_EXISTS');

    expect(await prisma.attendanceRecord.count({ where: { siteId: site.id, workerId: worker.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityType: 'attendance_record', action: 'create' } })).toBe(1);
  });

  it('the site list filtered by date and worker returns the fields the mobile queue compares', async () => {
    const { sup, project, site, worker } = await siteWithSupervisor('dup-at-3');
    const created = await app.inject({
      method: 'POST',
      url: ATTENDANCE(project.id, site.id),
      headers: { authorization: `Bearer ${sup.accessToken}` },
      payload: { workerId: worker.id, date: '2026-11-23', status: 'late', checkInTime: '08:15', notes: 'bus late' },
    });
    expect(created.statusCode).toBe(201);

    const list = await app.inject({
      method: 'GET',
      url: `${ATTENDANCE(project.id, site.id)}?date=2026-11-23&workerId=${worker.id}`,
      headers: { authorization: `Bearer ${sup.accessToken}` },
    });
    expect(list.statusCode).toBe(200);
    const { records } = list.json();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      id:           created.json().record.id,
      workerId:     worker.id,
      recordedById: sup.id,
      status:       'late',
      checkInTime:  '08:15',
      checkOutTime: null,
      notes:        'bus late',
    });
  });
});

// ─── No answer about records the caller cannot see ───────────────────────────

describe('a caller without access to the site gets 404, never 409', () => {
  it('labour: a supervisor of another site posting for a worker who already has an entry', async () => {
    const { company, admin, project, site, worker } = await siteWithSupervisor('dup-scope-1');
    await createTestLabourEntry(company.id, project.id, site.id, worker.id, admin.id, { date: new Date('2026-11-20') });
    const otherSite = await createTestSite(company.id, project.id, 'Other site');
    const outsider = await createTestUser(app, company.id, 'site_supervisor', 'out-dup-scope-1');
    await assignUserToProject(company.id, project.id, outsider.id, otherSite.id);

    const res = await app.inject({
      method: 'POST',
      url: LABOUR(project.id, site.id),
      headers: { authorization: `Bearer ${outsider.accessToken}` },
      payload: { workerId: worker.id, date: '2026-11-20', hoursWorked: 8 },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).not.toBe('LABOUR_ENTRY_EXISTS');
  });

  it('attendance: a supervisor of another site posting for a worker who already has a record', async () => {
    const { company, admin, project, site, worker } = await siteWithSupervisor('dup-scope-2');
    await createTestAttendanceRecord(company.id, project.id, site.id, worker.id, admin.id, { date: new Date('2026-11-20') });
    const otherSite = await createTestSite(company.id, project.id, 'Other site');
    const outsider = await createTestUser(app, company.id, 'site_supervisor', 'out-dup-scope-2');
    await assignUserToProject(company.id, project.id, outsider.id, otherSite.id);

    const res = await app.inject({
      method: 'POST',
      url: ATTENDANCE(project.id, site.id),
      headers: { authorization: `Bearer ${outsider.accessToken}` },
      payload: { workerId: worker.id, date: '2026-11-20', status: 'present' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).not.toBe('ATTENDANCE_EXISTS');
  });

  it('another company: 404 or 403, never 409', async () => {
    const { company, admin, project, site, worker } = await siteWithSupervisor('dup-scope-3');
    await createTestLabourEntry(company.id, project.id, site.id, worker.id, admin.id, { date: new Date('2026-11-20') });
    const other = await createTestCompany(app, 'dup-scope-3-other');

    const res = await app.inject({
      method: 'POST',
      url: LABOUR(project.id, site.id),
      headers: { authorization: `Bearer ${other.admin.accessToken}` },
      payload: { workerId: worker.id, date: '2026-11-20', hoursWorked: 8 },
    });
    expect([403, 404]).toContain(res.statusCode);
  });
});
