/**
 * @jest-environment node
 */
// The web calls the API through its own /api/v1 proxy. When the refresh
// cookie is gone (signed out in another tab, or a refused refresh cleared it),
// an API call must still reach the API, which answers 401 and lets the page
// send the user to the sign-in page. A redirect to /login instead makes the
// call fail outright, and the page keeps showing a session that has ended.
import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';

const ORIGIN = 'https://app.example.test';

function run(pathname: string, withCookie: boolean) {
  const headers = new Headers();
  if (withCookie) headers.set('cookie', 'refreshToken=some-value');
  return middleware(new NextRequest(`${ORIGIN}${pathname}`, { headers }));
}

const redirectsToLogin = (res: Response) =>
  res.status === 307 && (res.headers.get('location') ?? '').startsWith(`${ORIGIN}/login`);
const passesThrough = (res: Response) =>
  res.status === 200 && res.headers.get('x-middleware-next') === '1';

describe('middleware: API calls without a refresh cookie', () => {
  it.each([
    '/api/v1/auth/me',
    '/api/v1/auth/logout',
    '/api/v1/dashboard',
    '/api/v1/notifications/count',
    '/api/v1/projects/123/deliveries',
  ])('%s reaches the API (which answers 401 itself)', (path) => {
    expect(passesThrough(run(path, false))).toBe(true);
  });

  it('the refresh, sign-in and password routes still pass', () => {
    for (const path of ['/api/v1/auth/refresh', '/api/v1/auth/login', '/api/v1/auth/forgot-password', '/api/v1/auth/reset-password']) {
      expect(passesThrough(run(path, false))).toBe(true);
    }
  });
});

describe('middleware: pages are still protected', () => {
  it('a page without a refresh cookie goes to the sign-in page, keeping the destination', () => {
    const res = run('/dashboard', false);
    expect(redirectsToLogin(res)).toBe(true);
    expect(new URL(res.headers.get('location')!).searchParams.get('next')).toBe('/dashboard');
  });

  it('a page whose name only starts with "api" is a page, not an API call', () => {
    expect(redirectsToLogin(run('/apiary', false))).toBe(true);
    expect(redirectsToLogin(run('/api', false))).toBe(true);
  });

  it('a page with a refresh cookie is shown', () => {
    expect(passesThrough(run('/dashboard', true))).toBe(true);
  });

  it('the sign-in page is shown without a cookie', () => {
    expect(passesThrough(run('/login', false))).toBe(true);
  });
});
