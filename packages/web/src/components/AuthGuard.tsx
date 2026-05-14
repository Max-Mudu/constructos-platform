'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div
        className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary"
        role="status"
        aria-label={label}
      />
    </div>
  );
}

/**
 * Wraps all protected (app) pages.
 *
 * Rendering rules:
 * - isHydrated=false  → spinner (bootstrap in flight, don't evaluate auth yet)
 * - isHydrated=true, user=null → spinner + redirect
 *   - sessionExpired=true  → /login?reason=expired&next=<path>
 *   - sessionExpired=false → /login  (unauthenticated fresh visit / post-logout)
 * - isHydrated=true, user set → render children
 *
 * isHydrated is set by setAuth / clearAuth / expireSession in auth.store.ts,
 * ensuring it only becomes true once the bootstrap attempt has fully resolved —
 * not on the initial render where user is null but bootstrap hasn't run yet.
 * This eliminates the race condition where AuthGuard sees user=null before
 * AuthBootstrap has had a chance to restore the session.
 *
 * This is the ONLY place that redirects on auth failure.
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, isHydrated, sessionExpired } = useAuthStore();
  const router   = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (isHydrated && !user) {
      console.log('[auth] redirecting unauthenticated user');
      if (sessionExpired) {
        const params = new URLSearchParams({ reason: 'expired', next: pathname });
        router.replace(`/login?${params.toString()}`);
      } else {
        router.replace('/login');
      }
    }
  }, [isHydrated, user, sessionExpired, pathname, router]);

  // Bootstrap not yet complete — block all rendering and effects.
  if (!isHydrated) return <Spinner label="Loading" />;

  // Auth cleared — redirect is in flight; show spinner instead of blank page.
  if (!user) return <Spinner label="Redirecting" />;

  return <>{children}</>;
}
