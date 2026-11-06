/**
 * Site-module hubs and role-gated site actions.
 *
 * Regressions covered:
 *  - /attendance, /labour, /targets were "Coming Soon" stubs and /inventory,
 *    /deliveries, /schedules had no page, so the sidebar led nowhere for users
 *    without a (valid) default site.
 *  - a stale default site (removed from the project, site deactivated) sent
 *    users straight to a 403/404 page.
 *  - create/delete controls were shown to roles the API rejects (finance
 *    officer "Add Target", contractor "Delete task", ...), which also writes a
 *    permission_denied audit entry on every attempt.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { UserRole } from '@/lib/types';
import {
  MODULE_ROLES, SITE_MODULES, canCreateInModule, canDeleteInModule, canViewModule,
  loadSiteHub, siteModuleHref, validDefaultSite, type SiteModule,
} from '@/lib/workflows-site-hub';
import { noAccessMessage } from '@/components/workflows/SiteModuleHub';

const APP_DIR = path.resolve(__dirname, '..', 'app', '(app)');
const API_ROUTES = path.resolve(__dirname, '..', '..', '..', 'api', 'src', 'routes');

// ── Role lists stay in sync with the API's requireRole() lists ──────────────

function apiRoles(file: string, constName: string): string[] {
  const src = fs.readFileSync(path.join(API_ROUTES, file), 'utf8');
  const m = src.match(new RegExp(`const ${constName}\\s*=\\s*\\[([^\\]]*)\\]`));
  if (!m) throw new Error(`${constName} not found in ${file}`);
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
}

const sorted = (r: readonly string[]) => [...r].sort();

describe('MODULE_ROLES mirrors the API route role lists', () => {
  const cases: Array<[SiteModule, string, { view: string; create: string; remove?: string }]> = [
    ['attendance', 'attendance.routes.ts', { view: 'VIEW_ROLES', create: 'WRITE_ROLES', remove: 'DELETE_ROLES' }],
    ['labour',     'labour.routes.ts',     { view: 'VIEW_ROLES', create: 'WRITE_ROLES', remove: 'DELETE_ROLES' }],
    ['targets',    'targets.routes.ts',    { view: 'VIEW_ROLES', create: 'WRITE_ROLES', remove: 'DELETE_ROLES' }],
    ['inventory',  'inventory.routes.ts',  { view: 'VIEW_ROLES', create: 'WRITE_ROLES' }],
    ['deliveries', 'delivery.routes.ts',   { view: 'VIEW_ROLES', create: 'WRITE_ROLES', remove: 'DELETE_ROLES' }],
    ['schedules',  'schedule.routes.ts',   { view: 'VIEW_ROLES', create: 'WRITE_ROLES', remove: 'MANAGE_ROLES' }],
  ];

  it.each(cases)('%s matches %s', (module, file, names) => {
    expect(sorted(MODULE_ROLES[module].view)).toEqual(apiRoles(file, names.view));
    expect(sorted(MODULE_ROLES[module].create)).toEqual(apiRoles(file, names.create));
    if (names.remove) expect(sorted(MODULE_ROLES[module].remove)).toEqual(apiRoles(file, names.remove));
    else expect(MODULE_ROLES[module].remove).toEqual([]);
  });

  it('positive control: the parser really reads the API file', () => {
    expect(apiRoles('delivery.routes.ts', 'DELETE_ROLES')).toEqual(['company_admin', 'project_manager']);
  });
});

describe('role gates used by the site page, targets page and task page', () => {
  const ALL: UserRole[] = ['company_admin', 'project_manager', 'site_supervisor', 'finance_officer', 'contractor', 'consultant', 'viewer', 'worker'];

  it('finance_officer can view targets but is not offered "Add Target"', () => {
    expect(canViewModule('finance_officer', 'targets')).toBe(true);
    expect(canCreateInModule('finance_officer', 'targets')).toBe(false);
  });

  it('contractor can create schedule tasks but is not offered Delete', () => {
    expect(canCreateInModule('contractor', 'schedules')).toBe(true);
    expect(canDeleteInModule('contractor', 'schedules')).toBe(false);
    expect(canDeleteInModule('project_manager', 'schedules')).toBe(true);
  });

  it('site_supervisor cannot delete delivery files (API DELETE_ROLES is admin/PM)', () => {
    expect(canDeleteInModule('site_supervisor', 'deliveries')).toBe(false);
  });

  it('viewer, worker and consultant see no site write actions', () => {
    for (const role of ['viewer', 'worker', 'consultant'] as UserRole[]) {
      for (const m of ['attendance', 'targets', 'labour', 'deliveries'] as SiteModule[]) {
        expect(canCreateInModule(role, m)).toBe(false);
      }
    }
  });

  it('every role can create only where it can also view', () => {
    for (const role of ALL) for (const m of SITE_MODULES) {
      if (canCreateInModule(role, m)) expect(canViewModule(role, m)).toBe(true);
    }
  });

  it('no role and an unknown user get nothing', () => {
    expect(canViewModule(undefined, 'attendance')).toBe(false);
    expect(canCreateInModule(null, 'deliveries')).toBe(false);
  });
});

// ── Hub pages exist for every sidebar workflow link ─────────────────────────

describe('site-module hub pages', () => {
  // /inventory, /deliveries and /schedules are only reached through the
  // sidebar's site-context rewrite today (see Sidebar.tsx isDefaultsShortcut);
  // route-integrity.test.ts asserts /inventory has no top-level page.
  const HUBS: SiteModule[] = ['attendance', 'labour', 'targets'];

  it.each(HUBS)('/%s has a hub page that is no longer a stub', (m) => {
    const file = path.join(APP_DIR, m, 'page.tsx');
    expect(fs.existsSync(file)).toBe(true);
    const src = fs.readFileSync(file, 'utf8');
    expect(src).toContain('SiteModuleHub');
    expect(src).toContain(`module="${m}"`);
    expect(src).not.toMatch(/Coming Soon/i);
  });

  it('builds site module hrefs', () => {
    expect(siteModuleHref('p1', 's1', 'deliveries')).toBe('/projects/p1/sites/s1/deliveries');
    expect(siteModuleHref('p1', 's1', 'attendance', 'new')).toBe('/projects/p1/sites/s1/attendance/new');
  });

  it('explains to workers where attendance lives instead of a 403', () => {
    expect(noAccessMessage('attendance', 'worker')).toMatch(/mobile app/i);
    expect(noAccessMessage('labour', 'viewer')).toMatch(/does not have access to Labour/);
  });
});

// ── Default-site resolution ──────────────────────────────────────────────────

const P1 = { id: 'p1', name: 'Alpha Tower' };
const P2 = { id: 'p2', name: 'Bridge' };
const site = (id: string, projectId: string, isActive = true, name = id) => ({ id, projectId, isActive, name });

describe('validDefaultSite', () => {
  const user = { defaultProjectId: 'p1', defaultSiteId: 's1' };

  it('accepts a default that is still reachable', () => {
    expect(validDefaultSite(user, [P1], [site('s1', 'p1')])).toEqual({ projectId: 'p1', siteId: 's1' });
  });

  it('rejects a default project the user was removed from', () => {
    expect(validDefaultSite(user, [P2], [site('s1', 'p1')])).toBeNull();
  });

  it('rejects a deactivated or missing default site', () => {
    expect(validDefaultSite(user, [P1], [site('s1', 'p1', false)])).toBeNull();
    expect(validDefaultSite(user, [P1], [site('s2', 'p1')])).toBeNull();
  });

  it('rejects a site that belongs to another project', () => {
    expect(validDefaultSite(user, [P1], [site('s1', 'p2')])).toBeNull();
  });

  it('returns null without defaults', () => {
    expect(validDefaultSite({ defaultProjectId: null, defaultSiteId: null }, [P1], [site('s1', 'p1')])).toBeNull();
    expect(validDefaultSite(null, [P1], [site('s1', 'p1')])).toBeNull();
  });
});

describe('loadSiteHub', () => {
  const deps = (sites: Record<string, ReturnType<typeof site>[] | Error>, projects = [P1, P2]) => ({
    listProjects: jest.fn(async () => projects),
    listSites: jest.fn(async (id: string) => {
      const v = sites[id];
      if (v instanceof Error) throw v;
      return v ?? [];
    }),
  });

  it('goes straight to a valid default site', async () => {
    const r = await loadSiteHub({ defaultProjectId: 'p2', defaultSiteId: 'b' },
      deps({ p1: [site('a', 'p1')], p2: [site('b', 'p2')] }));
    expect(r.target).toEqual({ projectId: 'p2', siteId: 'b' });
    expect(r.staleDefault).toBe(false);
  });

  it('flags a stale default and shows a picker when several sites exist', async () => {
    const r = await loadSiteHub({ defaultProjectId: 'p1', defaultSiteId: 'gone' },
      deps({ p1: [site('a', 'p1')], p2: [site('b', 'p2')] }));
    expect(r.target).toBeNull();
    expect(r.staleDefault).toBe(true);
    expect(r.choices.map((c) => c.site.id)).toEqual(['a', 'b']);
  });

  it('auto-opens the only active site when there is no default', async () => {
    const r = await loadSiteHub({ defaultProjectId: null, defaultSiteId: null },
      deps({ p1: [site('a', 'p1'), site('old', 'p1', false)], p2: [] }));
    expect(r.target).toEqual({ projectId: 'p1', siteId: 'a' });
  });

  it('lists active sites before inactive ones, then by project and site name', async () => {
    const r = await loadSiteHub(null, deps({
      p1: [site('z', 'p1', true, 'Zulu'), site('x', 'p1', false, 'Xray')],
      p2: [site('c', 'p2', true, 'Charlie')],
    }));
    expect(r.choices.map((c) => c.site.name)).toEqual(['Zulu', 'Charlie', 'Xray']);
  });

  it('survives a project whose sites fail to load (e.g. 403) and counts it', async () => {
    const r = await loadSiteHub(null, deps({ p1: new Error('403'), p2: [site('b', 'p2'), site('c', 'p2')] }));
    expect(r.failedProjects).toBe(1);
    expect(r.choices).toHaveLength(2);
    expect(r.target).toBeNull();
  });

  it('drops sites that do not belong to the project they were listed under', async () => {
    const r = await loadSiteHub(null, deps({ p1: [site('a', 'p1'), site('intruder', 'p9')], p2: [] }));
    expect(r.choices.map((c) => c.site.id)).toEqual(['a']);
  });

  it('returns an empty picker for a user with no projects', async () => {
    const r = await loadSiteHub(null, deps({}, []));
    expect(r).toEqual({ choices: [], target: null, staleDefault: false, failedProjects: 0 });
  });

  it('propagates a failed project list so the page can show the error', async () => {
    await expect(loadSiteHub(null, {
      listProjects: async () => { throw new Error('boom'); },
      listSites: async () => [],
    })).rejects.toThrow('boom');
  });
});
