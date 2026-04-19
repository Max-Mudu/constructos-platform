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

const APP_DIR = path.resolve(__dirname, '..', 'app', '(app)');

/**
 * Resolves a route href like "/projects" to the expected page.tsx path
 * inside src/app/(app)/.
 */
function resolvePagePath(href: string): string {
  // Strip leading slash and any query/hash
  const clean = href.replace(/^\//, '').split('?')[0].split('#')[0];
  return path.join(APP_DIR, clean, 'page.tsx');
}

function pageExists(href: string): boolean {
  return fs.existsSync(resolvePagePath(href));
}

// ── Sidebar nav items ─────────────────────────────────────────────────────────

describe('Sidebar nav links — all hrefs resolve to a real page.tsx', () => {
  it.each(NAV_ITEMS.map((item) => [item.label, item.href]))(
    '%s (%s) has a corresponding page.tsx',
    (_label, href) => {
      expect(pageExists(href as string)).toBe(true);
    },
  );
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
