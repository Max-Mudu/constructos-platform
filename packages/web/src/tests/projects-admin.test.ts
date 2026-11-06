/**
 * Project / site / member management: role lists mirror the API, status
 * options match the enum, and form payloads send only what the API accepts.
 *
 * Regressions covered:
 *  - /projects had no "New Project" entry point; the project page's Edit
 *    buttons and "Manage Members" did nothing; there was no way to add or
 *    edit a job site from the project page.
 *  - the project list filter offered "Cancelled" (not an API status) and no
 *    "Planning"; the create form offered "Archived", which hid the new
 *    project from the list (GET /projects excludes archived).
 */
import * as fs from 'fs';
import * as path from 'path';
import type { JobSite, Project, UserRole } from '@/lib/types';
import {
  PROJECT_ROLES, PROJECT_STATUSES, SITE_ROLES, canCreateProject, canCreateSite, canEditProject,
  canEditSite, projectFormErrors, projectToForm, projectUpdatePayload, selectableStatuses,
  siteCreatePayload, siteFormErrors, siteToForm, siteUpdatePayload, statusLabel,
} from '@/lib/projects-admin-api';
import { ASSIGNABLE_ROLES, MEMBER_ROLES } from '@/lib/members-api';

const API_SRC = path.resolve(__dirname, '..', '..', '..', 'api', 'src');
const SCHEMA = path.resolve(__dirname, '..', '..', '..', 'api', 'prisma', 'schema.prisma');

/**
 * Roles in the requireRole(...) preHandler of `fastify.<method>('<route>'`.
 * Returns null when the route has no requireRole (any authenticated user).
 */
function routeRoles(file: string, method: 'get' | 'post' | 'patch' | 'delete', route: string): string[] | null {
  const src = fs.readFileSync(path.join(API_SRC, 'routes', file), 'utf8');
  const esc = route.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const m = src.match(new RegExp(`fastify\\.${method}\\(\\s*'${esc}'\\s*,\\s*\\{\\s*preHandler:\\s*\\[([\\s\\S]*?)\\]\\s*,?\\s*\\}`));
  if (!m) throw new Error(`${method.toUpperCase()} ${route} not found in ${file}`);
  const rr = m[1].match(/requireRole\(([^)]*)\)/);
  if (!rr) return null;
  return [...rr[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
}

const sorted = (r: readonly string[]) => [...r].sort();

describe('role lists mirror the API route preHandlers', () => {
  it('projects: create and update are company_admin only', () => {
    expect(sorted(PROJECT_ROLES.create)).toEqual(routeRoles('project.routes.ts', 'post', '/'));
    expect(sorted(PROJECT_ROLES.update)).toEqual(routeRoles('project.routes.ts', 'patch', '/:projectId'));
  });

  it('sites: create and update match jobsite.routes.ts', () => {
    expect(sorted(SITE_ROLES.create)).toEqual(routeRoles('jobsite.routes.ts', 'post', '/'));
    expect(sorted(SITE_ROLES.update)).toEqual(routeRoles('jobsite.routes.ts', 'patch', '/:siteId'));
  });

  it('members: list / add / remove match member.routes.ts', () => {
    expect(sorted(MEMBER_ROLES.list)).toEqual(routeRoles('member.routes.ts', 'get', '/'));
    expect(sorted(MEMBER_ROLES.add)).toEqual(routeRoles('member.routes.ts', 'post', '/'));
    expect(sorted(MEMBER_ROLES.remove)).toEqual(routeRoles('member.routes.ts', 'delete', '/:userId'));
  });

  it('assignable member roles match member.service.ts ASSIGNABLE_ROLES', () => {
    const src = fs.readFileSync(path.join(API_SRC, 'services', 'member.service.ts'), 'utf8');
    const m = src.match(/const ASSIGNABLE_ROLES[^=]*=\s*\[([^\]]*)\]/);
    expect(m).not.toBeNull();
    expect(sorted(ASSIGNABLE_ROLES)).toEqual([...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort());
  });

  it('positive controls: the parser reads real lists and detects "any authenticated"', () => {
    expect(routeRoles('jobsite.routes.ts', 'delete', '/:siteId')).toEqual(['company_admin']);
    expect(routeRoles('project.routes.ts', 'get', '/')).toBeNull();
    expect(() => routeRoles('project.routes.ts', 'post', '/does-not-exist')).toThrow();
  });

  it('helpers apply those lists', () => {
    const ALL: UserRole[] = ['company_admin', 'project_manager', 'site_supervisor', 'finance_officer', 'contractor', 'consultant', 'viewer', 'worker'];
    expect(ALL.filter((r) => canCreateProject(r))).toEqual(['company_admin']);
    expect(ALL.filter((r) => canEditProject(r))).toEqual(['company_admin']);
    expect(ALL.filter((r) => canCreateSite(r))).toEqual(['company_admin', 'project_manager']);
    expect(ALL.filter((r) => canEditSite(r))).toEqual(['company_admin', 'project_manager']);
    expect(canCreateProject(undefined)).toBe(false);
  });
});

describe('project status options', () => {
  function enumValues(): string[] {
    const schema = fs.readFileSync(SCHEMA, 'utf8');
    const m = schema.match(/enum ProjectStatus \{([^}]*)\}/);
    if (!m) throw new Error('ProjectStatus enum not found');
    return m[1].split(/\s+/).filter(Boolean);
  }

  it('PROJECT_STATUSES equals the Prisma enum and the route zod enum', () => {
    expect([...PROJECT_STATUSES].sort()).toEqual(enumValues().sort());
    const route = fs.readFileSync(path.join(API_SRC, 'routes', 'project.routes.ts'), 'utf8');
    const z = route.match(/projectStatusEnum = z\.enum\(\[([^\]]*)\]/);
    expect([...z![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort()).toEqual(enumValues().sort());
  });

  it('pickers offer planning and never "cancelled" or (for new/active projects) "archived"', () => {
    const values = selectableStatuses().map((o) => o.value);
    expect(values).toEqual(['planning', 'active', 'on_hold', 'completed']);
    expect(values).not.toContain('cancelled');
    for (const v of values) expect(enumValues()).toContain(v);
  });

  it('an archived project keeps "Archived" on its edit form', () => {
    expect(selectableStatuses('archived').map((o) => o.value)).toContain('archived');
    expect(statusLabel('on_hold')).toBe('On Hold');
  });

  it('pages use the shared options (no hard-coded cancelled/archived option)', () => {
    const app = path.resolve(__dirname, '..', 'app', '(app)', 'projects');
    for (const f of ['page.tsx', path.join('new', 'page.tsx'), path.join('[projectId]', 'edit', 'page.tsx')]) {
      const src = fs.readFileSync(path.join(app, f), 'utf8');
      expect(src).not.toMatch(/'cancelled'/);
      expect(src).not.toMatch(/value="archived"/);
    }
  });
});

const project = (o: Partial<Project> = {}): Project => ({
  id: 'p1', companyId: 'c1', name: 'Tower A', code: 'TA-1', description: 'Main block',
  status: 'active', startDate: '2026-11-01T00:00:00.000Z', endDate: null, location: 'Nairobi',
  createdAt: '2026-10-01T00:00:00.000Z', ...o,
});

describe('project form payloads', () => {
  it('maps a project to form values with date-only strings', () => {
    expect(projectToForm(project())).toEqual({
      name: 'Tower A', code: 'TA-1', description: 'Main block', location: 'Nairobi',
      startDate: '2026-11-01', endDate: '', status: 'active',
    });
  });

  it('sends only changed fields; cleared dates are null, cleared text is ""', () => {
    const before = project();
    const form = { ...projectToForm(before), name: ' Tower B ', startDate: '', location: '', endDate: '2027-01-31' };
    expect(projectUpdatePayload(before, form)).toEqual({
      name: 'Tower B', startDate: null, location: '', endDate: '2027-01-31',
    });
    expect(projectUpdatePayload(before, projectToForm(before))).toEqual({});
  });

  it('validates the name and date order', () => {
    const base = projectToForm(project());
    expect(projectFormErrors({ ...base, name: '  ' }).name).toBeDefined();
    expect(projectFormErrors({ ...base, startDate: '2026-12-01', endDate: '2026-11-01' }).endDate).toBeDefined();
    expect(projectFormErrors(base)).toEqual({});
  });
});

const site = (o: Partial<JobSite> = {}): JobSite => ({
  id: 's1', companyId: 'c1', projectId: 'p1', name: 'North Yard', address: 'Westlands',
  latitude: '-1.2683000', longitude: '36.8111000', isActive: true, createdAt: '2026-10-01T00:00:00.000Z', ...o,
});

describe('site form payloads', () => {
  it('create sends numbers for coordinates and omits empty fields', () => {
    expect(siteCreatePayload({ name: ' Gate ', address: '', latitude: '', longitude: '', isActive: true }))
      .toEqual({ name: 'Gate' });
    expect(siteCreatePayload({ name: 'Gate', address: 'Rd 1', latitude: '-1.5', longitude: '36.9', isActive: true }))
      .toEqual({ name: 'Gate', address: 'Rd 1', latitude: -1.5, longitude: 36.9 });
  });

  it('update sends changed fields only; cleared coordinates are null', () => {
    const before = site();
    const form = siteToForm(before);
    expect(form.latitude).toBe('-1.2683');
    expect(siteUpdatePayload(before, form)).toEqual({});
    expect(siteUpdatePayload(before, { ...form, isActive: false })).toEqual({ isActive: false });
    expect(siteUpdatePayload(before, { ...form, latitude: '', longitude: '' })).toEqual({ latitude: null, longitude: null });
    expect(siteUpdatePayload(before, { ...form, address: '' })).toEqual({ address: '' });
  });

  it('validates coordinates against the API bounds and requires both or neither', () => {
    const ok = siteToForm(site());
    expect(siteFormErrors(ok)).toEqual({});
    expect(siteFormErrors({ ...ok, latitude: '91' }).latitude).toBeDefined();
    expect(siteFormErrors({ ...ok, longitude: 'abc' }).longitude).toBeDefined();
    expect(siteFormErrors({ ...ok, longitude: '' }).longitude).toBeDefined();
    expect(siteFormErrors({ ...ok, name: '' }).name).toBeDefined();
  });
});
