/**
 * Site-scoped daily workflows (attendance, labour, targets, inventory,
 * deliveries, schedules) live under /projects/:projectId/sites/:siteId/<module>.
 * The top-level /attendance, /labour and /targets pages (sidebar "Daily
 * Targets", dashboard "Today Attendance") were "Coming Soon" stubs, so a pilot
 * user had no way in from them, and a stale default site sent users to a
 * 403/404 page. They are now hubs that open the user's valid default site or
 * offer a site picker. SiteModuleHub supports all six modules.
 *
 * Role lists mirror the API's requireRole() preHandlers (packages/api/src/
 * routes/*.routes.ts). They only decide what the UI offers — the API remains
 * the authority — so keep them in sync with the routes, never wider.
 */
import type { JobSite, Project, UserRole } from './types';

export type SiteModule = 'attendance' | 'labour' | 'targets' | 'inventory' | 'deliveries' | 'schedules';

type Roles = readonly UserRole[];

const ADMIN_PM: Roles = ['company_admin', 'project_manager'];
const ADMIN_PM_SUP: Roles = ['company_admin', 'project_manager', 'site_supervisor'];
const ADMIN_PM_SUP_FIN: Roles = ['company_admin', 'project_manager', 'site_supervisor', 'finance_officer'];

interface ModuleRoles {
  /** GET list/detail (VIEW_ROLES). */
  view: Roles;
  /** POST create (WRITE_ROLES). */
  create: Roles;
  /** DELETE (DELETE_ROLES / MANAGE_ROLES). */
  remove: Roles;
}

export const MODULE_ROLES: Record<SiteModule, ModuleRoles> = {
  // attendance.routes.ts:33-35
  attendance: { view: ADMIN_PM_SUP_FIN, create: ADMIN_PM_SUP, remove: ADMIN_PM },
  // labour.routes.ts:38-40
  labour:     { view: ADMIN_PM_SUP_FIN, create: ADMIN_PM_SUP, remove: ADMIN_PM },
  // targets.routes.ts:32-35
  targets:    { view: ADMIN_PM_SUP_FIN, create: ADMIN_PM_SUP, remove: ADMIN_PM },
  // inventory.routes.ts:9-20
  inventory:  { view: ADMIN_PM_SUP_FIN, create: ADMIN_PM_SUP, remove: [] },
  // delivery.routes.ts:76-80
  deliveries: {
    view: ['company_admin', 'project_manager', 'site_supervisor', 'finance_officer', 'viewer'],
    create: ADMIN_PM_SUP,
    remove: ADMIN_PM,
  },
  // schedule.routes.ts:93-96 (tasks: create = WRITE_ROLES, delete = MANAGE_ROLES)
  schedules: {
    view: ['company_admin', 'project_manager', 'site_supervisor', 'finance_officer', 'contractor', 'consultant'],
    create: ['company_admin', 'project_manager', 'contractor'],
    remove: ADMIN_PM,
  },
};

export const MODULE_TITLES: Record<SiteModule, string> = {
  attendance: 'Attendance',
  labour:     'Labour',
  targets:    'Daily Targets',
  inventory:  'Inventory',
  deliveries: 'Deliveries',
  schedules:  'Schedules',
};

export const SITE_MODULES = Object.keys(MODULE_ROLES) as SiteModule[];

const has = (roles: Roles, role: UserRole | null | undefined) => !!role && roles.includes(role);

export const canViewModule   = (role: UserRole | null | undefined, m: SiteModule) => has(MODULE_ROLES[m].view, role);
export const canCreateInModule = (role: UserRole | null | undefined, m: SiteModule) => has(MODULE_ROLES[m].create, role);
export const canDeleteInModule = (role: UserRole | null | undefined, m: SiteModule) => has(MODULE_ROLES[m].remove, role);

export function siteModuleHref(projectId: string, siteId: string, m: SiteModule, sub = ''): string {
  const tail = sub ? `/${sub.replace(/^\/+/, '')}` : '';
  return `/projects/${encodeURIComponent(projectId)}/sites/${encodeURIComponent(siteId)}/${m}${tail}`;
}

export interface SiteChoice {
  project: Pick<Project, 'id' | 'name'>;
  site: Pick<JobSite, 'id' | 'name' | 'isActive'>;
}

/**
 * The user's saved default site, but only if it is still reachable: the
 * project is in the user's scoped project list and the site is an active site
 * of that project. Returns null otherwise (the hub then shows a picker).
 */
export function validDefaultSite(
  user: { defaultProjectId: string | null; defaultSiteId: string | null } | null | undefined,
  projects: readonly Pick<Project, 'id'>[],
  sitesOfDefaultProject: readonly Pick<JobSite, 'id' | 'projectId' | 'isActive'>[] | null,
): { projectId: string; siteId: string } | null {
  const projectId = user?.defaultProjectId;
  const siteId = user?.defaultSiteId;
  if (!projectId || !siteId || !sitesOfDefaultProject) return null;
  if (!projects.some((p) => p.id === projectId)) return null;
  const site = sitesOfDefaultProject.find((s) => s.id === siteId);
  if (!site || site.projectId !== projectId || !site.isActive) return null;
  return { projectId, siteId };
}

export interface SiteHubLoad {
  choices: SiteChoice[];
  /** Where to go straight away: the valid default site, or the only active site. */
  target: { projectId: string; siteId: string } | null;
  /** The user has a saved default that is no longer reachable. */
  staleDefault: boolean;
  /** Projects whose site list could not be loaded (e.g. 403 after removal). */
  failedProjects: number;
}

export async function loadSiteHub(
  user: { defaultProjectId: string | null; defaultSiteId: string | null } | null | undefined,
  deps: {
    listProjects: () => Promise<Pick<Project, 'id' | 'name'>[]>;
    listSites: (projectId: string) => Promise<Pick<JobSite, 'id' | 'name' | 'projectId' | 'isActive'>[]>;
  },
): Promise<SiteHubLoad> {
  const projects = await deps.listProjects();
  const settled = await Promise.allSettled(projects.map((p) => deps.listSites(p.id)));

  const choices: SiteChoice[] = [];
  const sitesByProject = new Map<string, Pick<JobSite, 'id' | 'name' | 'projectId' | 'isActive'>[]>();
  let failedProjects = 0;
  settled.forEach((r, i) => {
    const project = projects[i];
    if (r.status === 'rejected') { failedProjects += 1; return; }
    // Defensive: only keep sites that really belong to this project.
    const sites = r.value.filter((s) => s.projectId === project.id);
    sitesByProject.set(project.id, sites);
    for (const site of sites) choices.push({ project: { id: project.id, name: project.name }, site });
  });

  const hasDefault = !!(user?.defaultProjectId && user?.defaultSiteId);
  const def = validDefaultSite(user, projects, user?.defaultProjectId ? sitesByProject.get(user.defaultProjectId) ?? null : null);
  const active = choices.filter((c) => c.site.isActive);
  const target = def ?? (active.length === 1 ? { projectId: active[0].project.id, siteId: active[0].site.id } : null);

  return { choices: sortSiteChoices(choices), target, staleDefault: hasDefault && !def, failedProjects };
}

/** Active sites first, then by project and site name. */
export function sortSiteChoices<T extends SiteChoice>(choices: readonly T[]): T[] {
  return [...choices].sort((a, b) =>
    Number(b.site.isActive) - Number(a.site.isActive)
    || a.project.name.localeCompare(b.project.name)
    || a.site.name.localeCompare(b.site.name));
}
