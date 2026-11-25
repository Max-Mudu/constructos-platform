/**
 * The page opened after signing in (the `next` query parameter) must be a page
 * of this app. Each result is also resolved the way the Next.js router resolves
 * router.push(href), so the test follows the router rather than a guess.
 */
import { addBasePath } from 'next/dist/client/add-base-path';
import { safeNextPath } from '@/lib/safe-next-path';

const APP_ORIGIN = 'https://app.example.test';
const BACKSLASH = String.fromCharCode(92);

function resolvedLikeRouter(href: string): URL {
  return new URL(addBasePath(href), `${APP_ORIGIN}/login`);
}

describe('safeNextPath — pages of this app are kept', () => {
  it.each([
    ['/dashboard', '/dashboard'],
    ['/projects/abc/sites/def', '/projects/abc/sites/def'],
    ['/projects/abc?tab=labour#today', '/projects/abc?tab=labour#today'],
    ['/invoices/new?projectId=p-1', '/invoices/new?projectId=p-1'],
  ])('%s', (next, expected) => {
    expect(safeNextPath(next)).toBe(expected);
  });
});

describe('safeNextPath — anything else falls back to the dashboard', () => {
  it.each([
    ['missing', null],
    ['empty', ''],
    ['relative', 'dashboard'],
    ['absolute URL', 'https://elsewhere.example/'],
    ['protocol-relative', '//elsewhere.example/page'],
    ['backslash form', `/${BACKSLASH}elsewhere.example/page`],
    ['mixed slashes', `/${BACKSLASH}/elsewhere.example`],
    ['tab inside', '/\t/elsewhere.example'],
    ['newline inside', '/\n/elsewhere.example'],
    ['leading space', ' //elsewhere.example'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['dot segment', '/.//elsewhere.example'],
    ['parent segment', '/a/..//elsewhere.example'],
    ['parent at root', '/..//elsewhere.example'],
    ['encoded dot segment', '/%2e//elsewhere.example'],
    ['encoded parent segment', '/%2E%2E//elsewhere.example'],
    ['dot segment then backslash', `/./${BACKSLASH}elsewhere.example`],
    ['parent segment then mixed slashes', `/x/../${BACKSLASH}/elsewhere.example`],
  ])('%s', (_label, next) => {
    expect(safeNextPath(next)).toBe('/dashboard');
  });

  it('uses the given fallback', () => {
    expect(safeNextPath('//elsewhere.example', '/projects')).toBe('/projects');
  });
});

describe('safeNextPath — the router keeps every result inside the app', () => {
  const inputs = [
    '/dashboard',
    '/projects/abc?tab=labour#today',
    '/%2F%2Felsewhere.example',
    '//elsewhere.example/page',
    `/${BACKSLASH}elsewhere.example/page`,
    `/${BACKSLASH}/elsewhere.example`,
    '/\t/elsewhere.example',
    '/\n/elsewhere.example',
    '///elsewhere.example',
    'https://elsewhere.example/',
  ];

  it.each(inputs)('%j', (next) => {
    expect(resolvedLikeRouter(safeNextPath(next)).origin).toBe(APP_ORIGIN);
  });

  it('every combination of a dot or parent prefix and a run of slashes stays in the app', () => {
    const prefixes = ['', '/.', '/..', '/a/..', '/a/b/../..', '/%2e', '/%2E', '/%2e%2e', '/.%2e', '/a/%2E%2E'];
    const runs = ['/', BACKSLASH, '//', `${BACKSLASH}/`, `/${BACKSLASH}`, `${BACKSLASH}${BACKSLASH}`, '///', '/\t/', '/\n/'];
    let tried = 0;
    for (const prefix of prefixes) {
      for (const run of runs) {
        for (const tail of ['elsewhere.example', 'elsewhere.example/x?y=1#z']) {
          const next = `${prefix}${run}${tail}`;
          const result = safeNextPath(next);
          expect({ next, origin: resolvedLikeRouter(result).origin }).toEqual({ next, origin: APP_ORIGIN });
          expect(result.startsWith('//')).toBe(false);
          tried++;
        }
      }
    }
    expect(tried).toBe(prefixes.length * runs.length * 2);
  });

  it('a kept page stays the same page when resolved again', () => {
    for (const next of ['/dashboard', '/projects/abc?tab=labour#today', '/a/../projects', '/%2e/projects']) {
      const result = safeNextPath(next);
      expect(safeNextPath(result)).toBe(result);
      expect(resolvedLikeRouter(result).origin).toBe(APP_ORIGIN);
    }
  });

  it('the unchecked forms would leave the app (control)', () => {
    // Without the check, these values pass a "starts with /" test and the
    // router navigates to another host.
    for (const next of ['//elsewhere.example/page', `/${BACKSLASH}elsewhere.example/page`]) {
      expect(next.startsWith('/')).toBe(true);
      expect(resolvedLikeRouter(next).origin).not.toBe(APP_ORIGIN);
    }
  });
});
