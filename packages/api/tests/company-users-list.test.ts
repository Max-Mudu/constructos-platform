import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import {
  createTestCompany,
  createTestUser,
  createTestProject,
  createTestSite,
  assignUserToProject,
  clearDatabase,
} from './helpers/fixtures';

const ENDPOINT = '/api/v1/companies/me/users';

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

function list(token: string | null, query = '') {
  return app.inject({
    method: 'GET',
    url:    `${ENDPOINT}${query}`,
    ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
  });
}

/** Every key the list endpoint is allowed to return for one user. */
const ALLOWED_USER_KEYS = [
  'consultantType',
  'createdAt',
  'defaultProject',
  'defaultSite',
  'email',
  'firstName',
  'id',
  'isActive',
  'lastName',
  'phone',
  'projectMemberships',
  'role',
  'setupPending',
].sort();

const ALLOWED_MEMBERSHIP_KEYS = ['assignedAt', 'projectId', 'projectName', 'siteId', 'siteName'].sort();

// ─── Authorization ────────────────────────────────────────────────────────────

describe('GET /companies/me/users — authorization', () => {
  it('rejects an unauthenticated request with 401', async () => {
    const res = await list(null);
    expect(res.statusCode).toBe(401);
  });

  it('rejects an invalid bearer token with 401', async () => {
    const res = await list('not-a-real-token');
    expect(res.statusCode).toBe(401);
  });

  it('rejects every non company_admin role with 403', async () => {
    const { company } = await createTestCompany(app, 'cul-authz');

    const roles = [
      'finance_officer',
      'project_manager',
      'site_supervisor',
      'contractor',
      'consultant',
      'worker',
      'viewer',
    ] as const;

    for (const role of roles) {
      const actor = await createTestUser(app, company.id, role, `cul-authz-${role}`);
      const res   = await list(actor.accessToken);
      expect({ role, status: res.statusCode }).toEqual({ role, status: 403 });
      expect(res.json().users).toBeUndefined();
    }
  });

  it('allows company_admin — 200', async () => {
    const { admin } = await createTestCompany(app, 'cul-ok');
    const res = await list(admin.accessToken);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().users)).toBe(true);
  });
});

// ─── Tenant isolation ─────────────────────────────────────────────────────────

describe('GET /companies/me/users — tenant isolation', () => {
  it('never returns users of another company', async () => {
    const a = await createTestCompany(app, 'cul-tenant-a');
    const b = await createTestCompany(app, 'cul-tenant-b');
    await createTestUser(app, a.company.id, 'site_supervisor', 'cul-a-sup');
    const bUser = await createTestUser(app, b.company.id, 'site_supervisor', 'cul-b-sup');

    const res = await list(a.admin.accessToken);
    expect(res.statusCode).toBe(200);

    const ids: string[] = res.json().users.map((u: { id: string }) => u.id);
    expect(ids).not.toContain(b.admin.id);
    expect(ids).not.toContain(bUser.id);
    expect(res.json().total).toBe(2); // admin A + supervisor A

    const companyIds = await prisma.user.findMany({
      where:  { id: { in: ids } },
      select: { companyId: true },
    });
    expect(new Set(companyIds.map((u) => u.companyId))).toEqual(new Set([a.company.id]));
  });

  it('ignores a companyId supplied in the query string', async () => {
    const a = await createTestCompany(app, 'cul-forge-a');
    const b = await createTestCompany(app, 'cul-forge-b');

    const res = await list(a.admin.accessToken, `?companyId=${b.company.id}`);
    expect(res.statusCode).toBe(200);
    const ids: string[] = res.json().users.map((u: { id: string }) => u.id);
    expect(ids).toEqual([a.admin.id]);
  });

  it('cannot find another company\'s users through search', async () => {
    const a = await createTestCompany(app, 'cul-search-a');
    const b = await createTestCompany(app, 'cul-search-b');

    const res = await list(a.admin.accessToken, `?search=${encodeURIComponent(b.admin.email)}`);
    expect(res.statusCode).toBe(200);
    expect(res.json().users).toEqual([]);
    expect(res.json().total).toBe(0);
  });

  it('does not list super_admin accounts', async () => {
    const { company, admin } = await createTestCompany(app, 'cul-super');
    const sa = await createTestUser(app, company.id, 'super_admin', 'cul-super-sa');

    const res = await list(admin.accessToken);
    const ids: string[] = res.json().users.map((u: { id: string }) => u.id);
    expect(ids).toContain(admin.id);
    expect(ids).not.toContain(sa.id);

    const filtered = await list(admin.accessToken, '?role=super_admin');
    expect(filtered.statusCode).toBe(422);
  });
});

// ─── Response shape ───────────────────────────────────────────────────────────

describe('GET /companies/me/users — response shape', () => {
  it('returns only allowlisted fields and no credentials', async () => {
    const { company, admin } = await createTestCompany(app, 'cul-shape');
    const project = await createTestProject(company.id, 'Shape Project');
    const site    = await createTestSite(company.id, project.id, 'Shape Site');
    const pm      = await createTestUser(app, company.id, 'project_manager', 'cul-shape-pm');
    await prisma.user.update({
      where: { id: pm.id },
      data:  { defaultProjectId: project.id, defaultSiteId: site.id, failedLoginCount: 3 },
    });
    await assignUserToProject(company.id, project.id, pm.id, site.id);

    // Credential material that must never surface
    await prisma.refreshToken.create({
      data: { userId: pm.id, tokenHash: 'r'.repeat(64), expiresAt: new Date(Date.now() + 60_000) },
    });
    await prisma.passwordResetToken.create({
      data: { userId: pm.id, tokenHash: 'p'.repeat(64), expiresAt: new Date(Date.now() + 60_000) },
    });

    const res = await list(admin.accessToken);
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(Object.keys(body).sort()).toEqual(['limit', 'offset', 'total', 'users']);

    for (const user of body.users) {
      expect(Object.keys(user).sort()).toEqual(ALLOWED_USER_KEYS);
      for (const m of user.projectMemberships) {
        expect(Object.keys(m).sort()).toEqual(ALLOWED_MEMBERSHIP_KEYS);
      }
      if (user.defaultProject) expect(Object.keys(user.defaultProject).sort()).toEqual(['id', 'name']);
      if (user.defaultSite) expect(Object.keys(user.defaultSite).sort()).toEqual(['id', 'name']);
    }

    const raw = res.body;
    for (const forbidden of [
      'passwordHash', 'password', 'tokenHash', 'refreshToken', 'failedLoginCount',
      'lockedAt', 'lastLoginAt', 'companyId', 'r'.repeat(64), 'p'.repeat(64), '$2',
    ]) {
      expect(raw).not.toContain(forbidden);
    }

    const pmRow = body.users.find((u: { id: string }) => u.id === pm.id);
    expect(pmRow.defaultProject).toEqual({ id: project.id, name: 'Shape Project' });
    expect(pmRow.defaultSite).toEqual({ id: site.id, name: 'Shape Site' });
    expect(pmRow.projectMemberships).toEqual([
      expect.objectContaining({
        projectId: project.id, projectName: 'Shape Project', siteId: site.id, siteName: 'Shape Site',
      }),
    ]);
    expect(pmRow.isActive).toBe(true);

    const adminRow = body.users.find((u: { id: string }) => u.id === admin.id);
    expect(adminRow.defaultProject).toBeNull();
    expect(adminRow.defaultSite).toBeNull();
    expect(adminRow.projectMemberships).toEqual([]);
  });

  it('reports project-wide memberships with null site and excludes removed memberships', async () => {
    const { company, admin } = await createTestCompany(app, 'cul-members');
    const p1 = await createTestProject(company.id, 'Wide Project');
    const p2 = await createTestProject(company.id, 'Removed Project');
    const viewer = await createTestUser(app, company.id, 'viewer', 'cul-members-v');
    await assignUserToProject(company.id, p1.id, viewer.id);
    await assignUserToProject(company.id, p2.id, viewer.id);
    await prisma.projectMember.updateMany({
      where: { userId: viewer.id, projectId: p2.id },
      data:  { removedAt: new Date() },
    });

    const res = await list(admin.accessToken);
    const row = res.json().users.find((u: { id: string }) => u.id === viewer.id);
    expect(row.projectMemberships).toHaveLength(1);
    expect(row.projectMemberships[0]).toMatchObject({
      projectId: p1.id, projectName: 'Wide Project', siteId: null, siteName: null,
    });
  });

  it('lists a user created through POST with the same defaults', async () => {
    const { company, admin } = await createTestCompany(app, 'cul-roundtrip');
    const project = await createTestProject(company.id, 'RT Project');
    const site    = await createTestSite(company.id, project.id, 'RT Site');

    const created = await app.inject({
      method:  'POST',
      url:     ENDPOINT,
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: {
        email: 'rt.consultant@test.com', firstName: 'Rita', lastName: 'Tan',
        role: 'consultant', consultantType: 'architect',
        defaultProjectId: project.id, defaultSiteId: site.id,
      },
    });
    expect(created.statusCode).toBe(201);

    const res = await list(admin.accessToken, '?role=consultant');
    expect(res.json().users).toEqual([
      expect.objectContaining({
        id: created.json().user.id,
        email: 'rt.consultant@test.com',
        role: 'consultant',
        consultantType: 'architect',
        isActive: true,
        defaultProject: { id: project.id, name: 'RT Project' },
        defaultSite: { id: site.id, name: 'RT Site' },
      }),
    ]);
  });
});

// ─── Filters, ordering, pagination ────────────────────────────────────────────

describe('GET /companies/me/users — filters', () => {
  async function seed() {
    const { company, admin } = await createTestCompany(app, 'cul-filter');
    const sup = await createTestUser(app, company.id, 'site_supervisor', 'cul-f-sup');
    const fin = await createTestUser(app, company.id, 'finance_officer', 'cul-f-fin');
    const off = await createTestUser(app, company.id, 'viewer', 'cul-f-off');
    await prisma.user.update({ where: { id: sup.id }, data: { firstName: 'Zelda', lastName: 'Okafor' } });
    await prisma.user.update({ where: { id: fin.id }, data: { firstName: 'Amina', lastName: 'Berg' } });
    await prisma.user.update({ where: { id: off.id }, data: { firstName: 'Musa', lastName: 'Kariuki', isActive: false } });
    return { company, admin, sup, fin, off };
  }

  it('filters by role', async () => {
    const { admin, sup } = await seed();
    const res = await list(admin.accessToken, '?role=site_supervisor');
    expect(res.statusCode).toBe(200);
    expect(res.json().users.map((u: { id: string }) => u.id)).toEqual([sup.id]);
    expect(res.json().total).toBe(1);
  });

  it('filters by isActive', async () => {
    const { admin, off } = await seed();
    const inactive = await list(admin.accessToken, '?isActive=false');
    expect(inactive.json().users.map((u: { id: string }) => u.id)).toEqual([off.id]);

    const active = await list(admin.accessToken, '?isActive=true');
    const ids: string[] = active.json().users.map((u: { id: string }) => u.id);
    expect(ids).not.toContain(off.id);
    expect(ids).toHaveLength(3);
  });

  it('searches first name, last name and email case-insensitively', async () => {
    const { admin, sup, fin } = await seed();

    const byFirst = await list(admin.accessToken, '?search=zELDa');
    expect(byFirst.json().users.map((u: { id: string }) => u.id)).toEqual([sup.id]);

    const byLast = await list(admin.accessToken, '?search=berg');
    expect(byLast.json().users.map((u: { id: string }) => u.id)).toEqual([fin.id]);

    const byEmail = await list(admin.accessToken, `?search=${encodeURIComponent('FINANCE_OFFICER-cul-f-fin')}`);
    expect(byEmail.json().users.map((u: { id: string }) => u.id)).toEqual([fin.id]);
  });

  it('combines filters', async () => {
    const { admin, off } = await seed();
    const res = await list(admin.accessToken, '?role=viewer&isActive=false&search=musa');
    expect(res.json().users.map((u: { id: string }) => u.id)).toEqual([off.id]);

    const none = await list(admin.accessToken, '?role=viewer&isActive=true');
    expect(none.json().users).toEqual([]);
  });

  it('orders by first name then last name', async () => {
    const { admin } = await seed();
    const res = await list(admin.accessToken);
    const names = res.json().users.map((u: { firstName: string }) => u.firstName);
    expect(names).toEqual(['Admin', 'Amina', 'Musa', 'Zelda']);
  });

  it('paginates with limit and offset and reports the total', async () => {
    const { admin } = await seed();
    const first = await list(admin.accessToken, '?limit=2');
    expect(first.json()).toMatchObject({ total: 4, limit: 2, offset: 0 });
    expect(first.json().users.map((u: { firstName: string }) => u.firstName)).toEqual(['Admin', 'Amina']);

    const second = await list(admin.accessToken, '?limit=2&offset=2');
    expect(second.json().users.map((u: { firstName: string }) => u.firstName)).toEqual(['Musa', 'Zelda']);
  });

  it('rejects invalid query values with 422', async () => {
    const { admin } = await createTestCompany(app, 'cul-bad-query');
    for (const q of [
      '?role=not_a_role',
      '?isActive=yes',
      '?isActive=1',
      '?limit=0',
      '?limit=201',
      '?limit=abc',
      '?offset=-1',
      `?search=${'x'.repeat(101)}`,
    ]) {
      const res = await list(admin.accessToken, q);
      expect({ q, status: res.statusCode }).toEqual({ q, status: 422 });
    }
  });
});
