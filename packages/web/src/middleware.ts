import { NextRequest, NextResponse } from 'next/server';

// Routes that do NOT require authentication
const PUBLIC_PATHS = ['/login', '/register', '/forgot-password', '/reset-password'];

// Routes that are always accessible regardless of auth state
const ALWAYS_ALLOWED = ['/_next', '/favicon.ico'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow Next.js internals
  if (ALWAYS_ALLOWED.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // API calls go through the /api/v1 proxy to the API, which authenticates
  // every request itself. Without a refresh cookie (signed out in another tab,
  // or a refused refresh cleared it) the API answers 401 and the page sends
  // the user to the sign-in page. Redirecting the call to /login instead would
  // make it fail outright, and the page would keep showing an ended session.
  if (pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // Allow auth pages unconditionally.
  //
  // We intentionally do NOT redirect cookie-holding users away from /login here.
  // The cookie may be present but the underlying session may be expired or
  // invalidated server-side. Redirecting cookie→/dashboard in middleware would
  // create an infinite loop:
  //   AuthGuard sees user=null → router.replace('/login')
  //   middleware sees cookie  → redirect to /dashboard
  //   AuthBootstrap refresh fails → back to step 1
  //
  // The "already logged in" redirect is handled purely client-side by AuthGuard:
  // it blocks the app layout from rendering until auth is confirmed, so an
  // authenticated user who navigates to /login is simply shown the login page.
  if (PUBLIC_PATHS.includes(pathname)) {
    return NextResponse.next();
  }

  // Protect all other routes — redirect to /login with the intended destination
  // so the user lands there after a successful login.
  const hasRefreshToken = request.cookies.has('refreshToken');
  if (!hasRefreshToken) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  // Run middleware on all routes except static files
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
