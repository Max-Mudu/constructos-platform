import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import {
  createTestCompany,
  createTestUser,
  createTestProject,
  createTestSite,
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function post(token: string | null, payload: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url:    ENDPOINT,
    ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
    payload,
  });
}

/** Minimum body for a company-wide role, which needs no project/site. */
function body(overrides: Record<string, unknown> = {}) {
  return {
    email:     'new.user@test.com',
    firstName: 'New',
    lastName:  'User',
    role:      'finance_officer',
    ...overrides,
  };
}

/** A company with an admin, plus a project and site belonging to it. */
async function companyWithSite(slug: string) {
  const { company, admin } = await createTestCompany(app, slug);
  const project = await createTestProject(company.id, `${slug} Project`);
  const site    = await createTestSite(company.id, project.id, `${slug} Site`);
  return { company, admin, project, site };
}

/** Pulls the raw token out of a setup URL, as the reset-password tests do. */
function tokenFromLink(setupLink: string): string {
  return setupLink.split('token=')[1]!;
}

// ─── Authorization ────────────────────────────────────────────────────────────

describe('POST /companies/me/users — authorization', () => {
  // Behaviour 1
  it('rejects an unauthenticated request with 401', async () => {
    const res = await post(null, body());
    expect(res.statusCode).toBe(401);
  });

  // Behaviour 2 — every non-admin Slice-1 role is refused
  it('rejects non company_admin roles with 403', async () => {
    const { company } = await createTestCompany(app, 'cu-authz');

    for (const role of ['project_manager', 'site_supervisor', 'finance_officer'] as const) {
      const actor = await createTestUser(app, company.id, role, `cu-authz-${role}`);
      const res   = await post(actor.accessToken, body());
      expect(res.statusCode).toBe(403);
    }
  });

  // Behaviour 3
  it('allows company_admin to create a user — 201', async () => {
    const { admin } = await createTestCompany(app, 'cu-create');

    const res = await post(admin.accessToken, body());

    expect(res.statusCode).toBe(201);
    expect(res.json().user.email).toBe('new.user@test.com');
  });
});

// ─── Tenant boundary ──────────────────────────────────────────────────────────

describe('POST /companies/me/users — tenant boundary', () => {
  // Behaviour 4
  it('creates the user inside the calling company', async () => {
    const { company, admin } = await createTestCompany(app, 'cu-tenant-own');

    const res = await post(admin.accessToken, body());

    expect(res.statusCode).toBe(201);
    const created = await prisma.user.findUnique({ where: { email: 'new.user@test.com' } });
    expect(created!.companyId).toBe(company.id);
  });

  // Behaviour 5 — a forged companyId in the body must not take effect
  it('ignores a companyId supplied in the request body', async () => {
    const { company: companyA, admin } = await createTestCompany(app, 'cu-forge-a');
    const { company: companyB }        = await createTestCompany(app, 'cu-forge-b');

    const res = await post(admin.accessToken, body({ companyId: companyB.id }));

    expect(res.statusCode).toBe(201);
    const created = await prisma.user.findUnique({ where: { email: 'new.user@test.com' } });
    expect(created!.companyId).toBe(companyA.id);
    expect(created!.companyId).not.toBe(companyB.id);
  });

  // Behaviour 6 — another tenant's project must look absent, not forbidden
  it('returns 404 for a defaultProjectId belonging to another company', async () => {
    const { admin } = await createTestCompany(app, 'cu-foreign-proj-a');
    const foreign   = await companyWithSite('cu-foreign-proj-b');

    const res = await post(admin.accessToken, body({
      role:             'project_manager',
      defaultProjectId: foreign.project.id,
      defaultSiteId:    foreign.site.id,
    }));

    expect(res.statusCode).toBe(404);
    expect(await prisma.user.findUnique({ where: { email: 'new.user@test.com' } })).toBeNull();
  });

  // Behaviour 7
  it('returns 404 for a defaultSiteId belonging to another company', async () => {
    const own     = await companyWithSite('cu-foreign-site-a');
    const foreign = await companyWithSite('cu-foreign-site-b');

    const res = await post(own.admin.accessToken, body({
      role:             'project_manager',
      defaultProjectId: own.project.id,
      defaultSiteId:    foreign.site.id,
    }));

    expect(res.statusCode).toBe(404);
    expect(await prisma.user.findUnique({ where: { email: 'new.user@test.com' } })).toBeNull();
  });

  // Behaviour 8 — both IDs are ours, but the site is not in that project
  it('returns 404 when the site belongs to a different project in the same company', async () => {
    const { company, admin } = await createTestCompany(app, 'cu-mismatch');
    const projectA = await createTestProject(company.id, 'Project A');
    const projectB = await createTestProject(company.id, 'Project B');
    const siteB    = await createTestSite(company.id, projectB.id, 'Site B');

    const res = await post(admin.accessToken, body({
      role:             'project_manager',
      defaultProjectId: projectA.id,
      defaultSiteId:    siteB.id,
    }));

    expect(res.statusCode).toBe(404);
    expect(await prisma.user.findUnique({ where: { email: 'new.user@test.com' } })).toBeNull();
  });
});

// ─── Role security ────────────────────────────────────────────────────────────

describe('POST /companies/me/users — role security', () => {
  // Behaviours 9 and 10 — no privilege escalation, no unlinked worker account
  it('rejects super_admin and worker roles with 422', async () => {
    const { admin } = await createTestCompany(app, 'cu-roles-bad');

    for (const role of ['super_admin', 'worker'] as const) {
      const res = await post(admin.accessToken, body({ role }));
      expect(res.statusCode).toBe(422);
    }

    expect(await prisma.user.findUnique({ where: { email: 'new.user@test.com' } })).toBeNull();
  });

  // Behaviour 11 — an admin may create a peer admin
  it('allows creating another company_admin', async () => {
    const { admin } = await createTestCompany(app, 'cu-peer-admin');

    const res = await post(admin.accessToken, body({ role: 'company_admin' }));

    expect(res.statusCode).toBe(201);
    expect(res.json().user.role).toBe('company_admin');
  });

  // Behaviours 12 and 13 — canViewFinance is derived from role, never supplied
  it('derives canViewFinance from the role and ignores any supplied value', async () => {
    const { company, admin } = await createTestCompany(app, 'cu-finance-flag');
    const project = await createTestProject(company.id, 'Fin Project');
    const site    = await createTestSite(company.id, project.id, 'Fin Site');

    const finance = await post(admin.accessToken, body({
      email:          'finance.derived@test.com',
      role:           'finance_officer',
      canViewFinance: false, // must be ignored
    }));
    expect(finance.statusCode).toBe(201);
    expect(finance.json().user.canViewFinance).toBe(true);

    const pm = await post(admin.accessToken, body({
      email:            'pm.derived@test.com',
      role:             'project_manager',
      defaultProjectId: project.id,
      defaultSiteId:    site.id,
      canViewFinance:   true, // must be ignored
    }));
    expect(pm.statusCode).toBe(201);
    expect(pm.json().user.canViewFinance).toBe(false);
  });
});

// ─── Project-access contract ──────────────────────────────────────────────────

describe('POST /companies/me/users — project access contract', () => {
  // Behaviours 14, 15 and 16 — project-scoped roles need BOTH ids
  it('requires both defaultProjectId and defaultSiteId for project-scoped roles', async () => {
    const { admin, project, site } = await companyWithSite('cu-both-required');

    const neither = await post(admin.accessToken, body({ role: 'project_manager' }));
    expect(neither.statusCode).toBe(422);

    const projectOnly = await post(admin.accessToken, body({
      role: 'project_manager', defaultProjectId: project.id,
    }));
    expect(projectOnly.statusCode).toBe(422);

    const siteOnly = await post(admin.accessToken, body({
      role: 'project_manager', defaultSiteId: site.id,
    }));
    expect(siteOnly.statusCode).toBe(422);

    expect(await prisma.user.findUnique({ where: { email: 'new.user@test.com' } })).toBeNull();
  });

  // Behaviour 17 — the defaults must be backed by real project access
  it('creates an active ProjectMember for a project-scoped role', async () => {
    const { company, admin, project, site } = await companyWithSite('cu-member-made');

    const res = await post(admin.accessToken, body({
      role:             'site_supervisor',
      defaultProjectId: project.id,
      defaultSiteId:    site.id,
    }));

    expect(res.statusCode).toBe(201);
    const created = res.json().user;
    expect(created.defaultProjectId).toBe(project.id);
    expect(created.defaultSiteId).toBe(site.id);

    const membership = await prisma.projectMember.findFirst({
      where: { userId: created.id, projectId: project.id, removedAt: null },
    });
    expect(membership).toBeTruthy();
    expect(membership!.siteId).toBe(site.id);
    expect(membership!.companyId).toBe(company.id);
  });

  // Behaviour 18 — company-wide roles need no membership row
  it('creates a finance_officer with no project/site and no ProjectMember row', async () => {
    const { admin } = await createTestCompany(app, 'cu-no-member');

    const res = await post(admin.accessToken, body({ role: 'finance_officer' }));

    expect(res.statusCode).toBe(201);
    const created = res.json().user;
    expect(created.defaultProjectId).toBeNull();
    expect(created.defaultSiteId).toBeNull();

    const memberships = await prisma.projectMember.findMany({ where: { userId: created.id } });
    expect(memberships).toHaveLength(0);
  });
});

// ─── Credential security ──────────────────────────────────────────────────────

describe('POST /companies/me/users — credential security', () => {
  // Behaviours 19 and 20
  it('never returns a password hash and stores only a bcrypt hash', async () => {
    const { admin } = await createTestCompany(app, 'cu-cred-hash');

    const res = await post(admin.accessToken, body());
    expect(res.statusCode).toBe(201);

    const payload = res.json();
    expect(payload.user.passwordHash).toBeUndefined();
    expect(payload.user.password).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain('passwordHash');

    const stored = await prisma.user.findUnique({ where: { email: 'new.user@test.com' } });
    expect(stored!.passwordHash).toMatch(/^\$2[aby]\$/); // bcrypt
    expect(stored!.passwordHash).not.toBe(payload.user.email);
    expect(stored!.passwordHash).not.toBe(payload.setupLink);
  });

  // Behaviour 23
  it('returns a setupLink to the reset-password page outside production', async () => {
    const { admin } = await createTestCompany(app, 'cu-cred-link');

    const res = await post(admin.accessToken, body());
    expect(res.statusCode).toBe(201);

    const setupLink: string = res.json().setupLink;
    expect(typeof setupLink).toBe('string');
    expect(setupLink).toContain('/reset-password?token=');
    expect(tokenFromLink(setupLink).length).toBeGreaterThan(32);
  });

  // Behaviours 21 and 22 — a live, single-use, hashed token exists for the new user
  it('creates a hashed, unused PasswordResetToken for the new user', async () => {
    const { admin } = await createTestCompany(app, 'cu-cred-token');

    const res = await post(admin.accessToken, body());
    expect(res.statusCode).toBe(201);

    const createdId = res.json().user.id;
    const rawToken  = tokenFromLink(res.json().setupLink);

    const tokens = await prisma.passwordResetToken.findMany({ where: { userId: createdId } });
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.usedAt).toBeNull();
    expect(tokens[0]!.expiresAt.getTime()).toBeGreaterThan(Date.now());

    // The raw token must never be stored as-is
    expect(tokens[0]!.tokenHash).not.toBe(rawToken);
    expect(tokens[0]!.tokenHash).toHaveLength(64); // sha256 hex
  });

  // Behaviour 24 — the whole credential path actually works
  it('lets the new user set a password via the setup link and then log in', async () => {
    const { admin } = await createTestCompany(app, 'cu-cred-e2e');

    const createRes = await post(admin.accessToken, body({
      email: 'invited.user@test.com',
    }));
    expect(createRes.statusCode).toBe(201);

    const token = tokenFromLink(createRes.json().setupLink);

    const resetRes = await app.inject({
      method:  'POST',
      url:     '/api/v1/auth/reset-password',
      payload: { token, password: 'ChosenPass1!' },
    });
    expect(resetRes.statusCode).toBe(200);

    const loginRes = await app.inject({
      method:  'POST',
      url:     '/api/v1/auth/login',
      payload: { email: 'invited.user@test.com', password: 'ChosenPass1!' },
    });
    expect(loginRes.statusCode).toBe(200);
    expect(loginRes.json().user.email).toBe('invited.user@test.com');
  });
});

// ─── Duplicates ───────────────────────────────────────────────────────────────

describe('POST /companies/me/users — duplicate email', () => {
  // Behaviour 25
  it('rejects an email already in use with 409', async () => {
    const { company, admin } = await createTestCompany(app, 'cu-dupe');
    const existing = await createTestUser(app, company.id, 'site_supervisor', 'cu-dupe-existing');

    const res = await post(admin.accessToken, body({ email: existing.email }));

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('CONFLICT');

    const sameEmail = await prisma.user.findMany({ where: { email: existing.email } });
    expect(sameEmail).toHaveLength(1);
  });
});

// ─── Audit ────────────────────────────────────────────────────────────────────

describe('POST /companies/me/users — audit', () => {
  // Behaviour 26
  it('writes a user-create audit row without leaking credentials', async () => {
    const { company, admin } = await createTestCompany(app, 'cu-audit');

    const res = await post(admin.accessToken, body());
    expect(res.statusCode).toBe(201);

    const createdId = res.json().user.id;
    const rawToken  = tokenFromLink(res.json().setupLink);

    const log = await prisma.auditLog.findFirst({
      where: { action: 'create', entityType: 'user', entityId: createdId },
    });
    expect(log).toBeTruthy();
    expect(log!.companyId).toBe(company.id);
    expect(log!.userId).toBe(admin.id); // the acting admin, not the new user

    const serialised = JSON.stringify(log!.changesAfter ?? {});
    expect(serialised).not.toContain(rawToken);
    expect(serialised.toLowerCase()).not.toContain('password');
  });
});

// ─── Data safety ──────────────────────────────────────────────────────────────

describe('POST /companies/me/users — data safety', () => {
  // Behaviour 27
  it('leaves existing users and companies untouched', async () => {
    const { company: companyA, admin } = await createTestCompany(app, 'cu-safety-a');
    const { company: companyB }        = await createTestCompany(app, 'cu-safety-b');
    const bystander = await createTestUser(app, companyA.id, 'site_supervisor', 'cu-safety-by');

    const usersBefore     = await prisma.user.findMany({ orderBy: { email: 'asc' } });
    const companiesBefore = await prisma.company.findMany({ orderBy: { slug: 'asc' } });

    const res = await post(admin.accessToken, body());
    expect(res.statusCode).toBe(201);

    // Every pre-existing user row is identical afterwards
    for (const prior of usersBefore) {
      const now = await prisma.user.findUnique({ where: { id: prior.id } });
      expect(now).toEqual(prior);
    }

    const companiesAfter = await prisma.company.findMany({ orderBy: { slug: 'asc' } });
    expect(companiesAfter).toEqual(companiesBefore);

    // The new user landed in company A only
    expect(await prisma.user.count({ where: { companyId: companyB.id } })).toBe(1);
    expect(bystander.companyId).toBe(companyA.id);
  });
});
