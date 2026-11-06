'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, ChevronRight, MapPin } from 'lucide-react';
import { projectApi, siteApi, ApiError } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import {
  canViewModule, loadSiteHub, MODULE_TITLES, siteModuleHref,
  type SiteHubLoad, type SiteModule,
} from '@/lib/workflows-site-hub';
import { PageHeader } from '@/components/ui/PageHeader';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Badge';

/** Message for a role the API does not allow to view this module. */
export function noAccessMessage(module: SiteModule, role: string | undefined): string {
  if (module === 'attendance' && role === 'worker') {
    return 'Workers check in and out from the ConstructOS mobile app. Your supervisor can see your attendance here.';
  }
  return `Your role does not have access to ${MODULE_TITLES[module]}. Ask your company admin if you need it.`;
}

/**
 * Entry point for a site-scoped workflow reached from the sidebar. Opens the
 * user's default site when it is still reachable (or the only active site),
 * otherwise lets the user pick one of the sites they can access.
 */
export function SiteModuleHub({ module, subtitle }: { module: SiteModule; subtitle: string }) {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const allowed = canViewModule(user?.role, module);

  const [state, setState] = useState<SiteHubLoad | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user || !allowed) return;
    let cancelled = false;
    setError('');
    loadSiteHub(user, {
      listProjects: () => projectApi.list().then((r) => r.projects),
      listSites: (projectId) => siteApi.list(projectId).then((r) => r.sites),
    })
      .then((res) => {
        if (cancelled) return;
        if (res.target) {
          router.replace(siteModuleHref(res.target.projectId, res.target.siteId, module));
          return;
        }
        setState(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load your projects and sites');
      });
    return () => { cancelled = true; };
  }, [user, allowed, module, router]);

  const title = MODULE_TITLES[module];

  if (user && !allowed) {
    return (
      <div className="px-6 py-8 space-y-6 animate-fade-in">
        <PageHeader title={title} />
        <Alert><AlertCircle className="h-4 w-4" /><AlertDescription>{noAccessMessage(module, user.role)}</AlertDescription></Alert>
      </div>
    );
  }

  return (
    <div className="px-6 py-8 space-y-6 animate-fade-in">
      <PageHeader title={title} subtitle={subtitle} />

      {error && (
        <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertDescription>{error}</AlertDescription></Alert>
      )}

      {!state && !error && (
        <div className="space-y-3" aria-label="Loading sites">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
        </div>
      )}

      {state && (
        <>
          {state.staleDefault && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Your default site is no longer available to you. Pick a site below, or choose a new default in{' '}
                <Link href="/settings" className="underline">Settings</Link>.
              </AlertDescription>
            </Alert>
          )}
          {state.failedProjects > 0 && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Sites for {state.failedProjects} project{state.failedProjects === 1 ? '' : 's'} could not be loaded.
              </AlertDescription>
            </Alert>
          )}

          {state.choices.length === 0 ? (
            <EmptyState
              icon={<MapPin className="h-12 w-12" />}
              title="No sites available"
              description="You are not assigned to any project site yet. Ask your project manager to add you to a project."
            />
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Choose a site to open {title.toLowerCase()}.</p>
              <ul className="divide-y divide-border rounded-xl border border-border bg-card">
                {state.choices.map(({ project, site }) => (
                  <li key={site.id}>
                    <Link
                      href={siteModuleHref(project.id, site.id, module)}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-accent/40 transition-colors"
                    >
                      <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">{site.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{project.name}</span>
                      </span>
                      {!site.isActive && <Badge variant="inactive">Inactive</Badge>}
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
