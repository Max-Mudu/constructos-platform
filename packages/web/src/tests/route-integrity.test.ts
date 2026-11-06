/**
 * Route integrity tests.
 *
 * Verifies that every href in nav-config.ts maps to a real page.tsx file,
 * and that known critical navigation links exist on disk.
 *
 * These are pure filesystem checks — no browser, no network, no rendering.
 * They catch broken sidebar links and missing pages before they reach users.
 */

import * as fs from 'fs';
import * as path from 'path';
import { NAV_ITEMS } from '@/components/sidebar/nav-config';
import { SITE_MODULES } from '@/lib/workflows-site-hub';

const APP_DIR = path.resolve(__dirname, '..', 'app', '(app)');
const DAILY_DIR = path.resolve(__dirname, '..', 'app', '(daily)');

/**
 * Route groups that serve pages. Next route groups do not prefix URLs, so an
 * href like "/daily" may live in any of them.
 */
const ROUTE_GROUP_DIRS = [APP_DIR, DAILY_DIR];

/**
 * Resolves a route href like "/projects" to the expected page.tsx path
 * inside the given route group directory (default src/app/(app)/).
 */
function resolvePagePath(href: string, groupDir: string = APP_DIR): string {
  // Strip leading slash and any query/hash
  const clean = href.replace(/^\//, '').split('?')[0].split('#')[0];
  return path.join(groupDir, clean, 'page.tsx');
}

function pageExists(href: string): boolean {
  return ROUTE_GROUP_DIRS.some((dir) => fs.existsSync(resolvePagePath(href, dir)));
}

// ── Sidebar nav items ─────────────────────────────────────────────────────────

/**
 * Sidebar.tsx links every nav item to its own href. Site workflows (attendance,
 * labour, targets, inventory, deliveries, schedules) used to be rewritten to
 * /projects/:projectId/sites/:siteId<href> and hidden without a default site;
 * they now link to top-level hub pages (SiteModuleHub) that open the default
 * site or a site picker. Sidebar.tsx is read here so the test follows the real
 * link logic instead of a hand-maintained copy.
 */
const SIDEBAR_SRC = fs.readFileSync(
  path.resolve(__dirname, '..', 'components', 'sidebar', 'Sidebar.tsx'),
  'utf8',
);

const SITE_MODULE_HREFS = SITE_MODULES.map((m) => `/${m}`);

/** True when the page at `href` is a SiteModuleHub for `module`. */
function isHubPageFor(href: string, module: string): boolean {
  const file = resolvePagePath(href);
  if (!fs.existsSync(file)) return false;
  const src = fs.readFileSync(file, 'utf8');
  return src.includes('SiteModuleHub') && src.includes(`module="${module}"`);
}

describe('Sidebar nav links — all hrefs resolve to a real page.tsx', () => {
  it('Sidebar links item.href directly, with no site-context rewrite (positive control)', () => {
    expect(SIDEBAR_SRC).toMatch(/href=\{item\.href\}/);
    expect(SIDEBAR_SRC).not.toMatch(/isDefaultsShortcut|resolvedHref|\/sites\/\$\{/);
  });

  it.each(NAV_ITEMS.map((item) => [item.label, item.href]))(
    '%s (%s) has a corresponding page.tsx',
    (_label, href) => {
      expect(pageExists(href as string)).toBe(true);
    },
  );

  it('every site workflow in the sidebar is a hub over a real site-scoped page', () => {
    const navSiteModules = NAV_ITEMS.map((i) => i.href).filter((h) => SITE_MODULE_HREFS.includes(h));
    expect(navSiteModules.sort()).toEqual([...SITE_MODULE_HREFS].sort());
    for (const href of navSiteModules) {
      expect(isHubPageFor(href, href.slice(1))).toBe(true);
      expect(pageExists(`/projects/[projectId]/sites/[siteId]${href}`)).toBe(true);
    }
  });

  it('paths that do not exist fail to resolve (negative control)', () => {
    expect(pageExists('/no-such-module')).toBe(false);
    expect(pageExists('/projects/[projectId]/sites/[siteId]/no-such-page')).toBe(false);
    // The hub detector rejects a real page that is not a hub, and a hub for another module.
    expect(isHubPageFor('/dashboard', 'dashboard')).toBe(false);
    expect(isHubPageFor('/inventory', 'deliveries')).toBe(false);
  });
});

// ── Critical app routes ───────────────────────────────────────────────────────

describe('Critical app routes exist', () => {
  const criticalRoutes = [
    '/dashboard',
    '/projects',
    '/projects/new',
    '/workers',
    '/workers/new',
    '/finance',
    '/labour',
    '/attendance',
    '/targets',
    '/inventory',
    '/deliveries',
    '/schedules',
    '/settings/team',
    '/contractors',
    '/contractors/new',
    '/consultants',
    '/drawings',
    '/budget',
    '/invoices',
    '/audit',
    '/settings',
  ];

  it.each(criticalRoutes)('%s has a page.tsx', (href) => {
    expect(pageExists(href)).toBe(true);
  });
});

// ── Dynamic route stubs exist ─────────────────────────────────────────────────

describe('Dynamic route page files exist', () => {
  const dynamicRoutes: Array<[string, string]> = [
    ['project detail',       path.join(APP_DIR, 'projects', '[projectId]', 'page.tsx')],
    ['project sites list',   path.join(APP_DIR, 'projects', '[projectId]', 'sites', 'page.tsx')],
    ['add site form',        path.join(APP_DIR, 'projects', '[projectId]', 'sites', 'new', 'page.tsx')],
    ['site detail',          path.join(APP_DIR, 'projects', '[projectId]', 'sites', '[siteId]', 'page.tsx')],
    ['site attendance',      path.join(APP_DIR, 'projects', '[projectId]', 'sites', '[siteId]', 'attendance', 'page.tsx')],
    ['new attendance',       path.join(APP_DIR, 'projects', '[projectId]', 'sites', '[siteId]', 'attendance', 'new', 'page.tsx')],
    ['site labour',          path.join(APP_DIR, 'projects', '[projectId]', 'sites', '[siteId]', 'labour', 'page.tsx')],
    ['new labour entry',     path.join(APP_DIR, 'projects', '[projectId]', 'sites', '[siteId]', 'labour', 'new', 'page.tsx')],
    ['site targets',         path.join(APP_DIR, 'projects', '[projectId]', 'sites', '[siteId]', 'targets', 'page.tsx')],
    ['new target',           path.join(APP_DIR, 'projects', '[projectId]', 'sites', '[siteId]', 'targets', 'new', 'page.tsx')],
    ['site deliveries',      path.join(APP_DIR, 'projects', '[projectId]', 'sites', '[siteId]', 'deliveries', 'page.tsx')],
    ['new delivery',         path.join(APP_DIR, 'projects', '[projectId]', 'sites', '[siteId]', 'deliveries', 'new', 'page.tsx')],
    ['delivery detail',      path.join(APP_DIR, 'projects', '[projectId]', 'sites', '[siteId]', 'deliveries', '[deliveryId]', 'page.tsx')],
    ['delivery edit',        path.join(APP_DIR, 'projects', '[projectId]', 'sites', '[siteId]', 'deliveries', '[deliveryId]', 'edit', 'page.tsx')],
    ['worker detail',        path.join(APP_DIR, 'workers', '[workerId]', 'page.tsx')],
    ['worker edit',          path.join(APP_DIR, 'workers', '[workerId]', 'edit', 'page.tsx')],
    ['contractor detail',    path.join(APP_DIR, 'contractors', '[contractorId]', 'page.tsx')],
    ['site schedules list',  path.join(APP_DIR, 'projects', '[projectId]', 'sites', '[siteId]', 'schedules', 'page.tsx')],
    ['new schedule task',    path.join(APP_DIR, 'projects', '[projectId]', 'sites', '[siteId]', 'schedules', 'new', 'page.tsx')],
    ['schedule task detail', path.join(APP_DIR, 'projects', '[projectId]', 'sites', '[siteId]', 'schedules', '[taskId]', 'page.tsx')],
  ];

  it.each(dynamicRoutes)('%s page.tsx exists', (_name, filePath) => {
    expect(fs.existsSync(filePath)).toBe(true);
  });
});

// ── Daily Report route group ──────────────────────────────────────────────────

describe('Daily Report routes exist under app/(daily)', () => {
  it('/daily resolves to a page.tsx', () => {
    expect(pageExists('/daily')).toBe(true);
    expect(fs.existsSync(resolvePagePath('/daily', DAILY_DIR))).toBe(true);
  });

  it('/daily is not also defined under app/(app) (no route-group collision)', () => {
    expect(fs.existsSync(resolvePagePath('/daily', APP_DIR))).toBe(false);
  });

  const dailyRoutes: Array<[string, string]> = [
    ['/daily layout',           path.join(DAILY_DIR, 'layout.tsx')],
    ['/daily site home',        path.join(DAILY_DIR, 'daily', '[projectId]', '[siteId]', 'page.tsx')],
    ['/daily report layout',    path.join(DAILY_DIR, 'daily', '[projectId]', '[siteId]', '[reportId]', 'layout.tsx')],
    ['/daily report capture',   path.join(DAILY_DIR, 'daily', '[projectId]', '[siteId]', '[reportId]', 'page.tsx')],
    ['/daily report review',    path.join(DAILY_DIR, 'daily', '[projectId]', '[siteId]', '[reportId]', 'review', 'page.tsx')],
    ['/daily report share',     path.join(DAILY_DIR, 'daily', '[projectId]', '[siteId]', '[reportId]', 'share', 'page.tsx')],
  ];

  it.each(dailyRoutes)('%s file exists', (_name, filePath) => {
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('a nav href that exists nowhere still fails to resolve (negative control)', () => {
    expect(pageExists('/daily-does-not-exist')).toBe(false);
  });
});

// ── Auth routes exist ─────────────────────────────────────────────────────────

describe('Auth routes exist', () => {
  const AUTH_DIR = path.resolve(__dirname, '..', 'app', '(auth)');

  it('/login page exists', () => {
    expect(fs.existsSync(path.join(AUTH_DIR, 'login', 'page.tsx'))).toBe(true);
  });

  it('/register page exists', () => {
    expect(fs.existsSync(path.join(AUTH_DIR, 'register', 'page.tsx'))).toBe(true);
  });
});

// ── No broken members route in project detail ────────────────────────────────

describe('Broken routes are NOT linked from nav-config', () => {
  it('nav-config does not link to /projects/[projectId]/members', () => {
    const hasMembersLink = NAV_ITEMS.some((item) =>
      item.href.includes('/members'),
    );
    expect(hasMembersLink).toBe(false);
  });
});
