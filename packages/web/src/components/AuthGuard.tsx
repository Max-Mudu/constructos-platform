'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';

/**
 * Wraps all protected (app) pages.
 *
 * Rendering rules:
 * - isBootstrapping=true  → show full-page spinner (refresh in flight)
 * - user=null, !bootstrapping → return null + redirect to /login
 *   - sessionExpired=true  → /login?reason=expired&next=<path>
 *   - sessionExpired=false → /login  (normal bootstrap failure or post-logout)
 * - user set, !bootstrapping → render children
 *
 * This is the ONLY place that redirects on auth failure, ensuring:
 * - No authenticated content ever renders with a null user
 * - No "Welcome back, !" placeholders appear
 * - The session-expired message and ?next= are reliably appended
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, isBootstrapping, sessionExpired } = useAuthStore();
  const router   = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isBootstrapping && !user) {
      if (sessionExpired) {
        const params = new URLSearchParams({ reason: 'expired', next: pathname });
        router.replace(`/login?${params.toString()}`);
      } else {
        // Post-logout or failed bootstrap — plain login, no expired banner.
        router.replace('/login');
      }
    }
  }, [isBootstrapping, user, sessionExpired, pathname, router]);

  // Bootstrap in progress — don't render page content or trigger page effects.
  if (isBootstrapping) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary"
          role="status"
          aria-label="Loading"
        />
      </div>
    );
  }

  // Auth cleared — redirect is in flight via the effect above.
  // Show the spinner rather than null so the user never sees a blank dark screen
  // while router.replace() is pending.
  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary"
          role="status"
          aria-label="Redirecting"
        />
      </div>
    );
  }

  return <>{children}</>;
}
