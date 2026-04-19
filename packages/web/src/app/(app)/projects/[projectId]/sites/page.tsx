'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { projectApi, siteApi, ApiError } from '@/lib/api';
import { Project, JobSite } from '@/lib/types';
import { useAuthStore } from '@/store/auth.store';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { Skeleton } from '@/components/ui/Skeleton';
import { Separator } from '@/components/ui/Separator';
import { ArrowLeft, Building2, MapPin, ChevronRight, Plus, AlertCircle } from 'lucide-react';

export default function SiteListPage() {
  const { projectId }         = useParams<{ projectId: string }>();
  const router                = useRouter();
  const { user }              = useAuthStore();
  const [project, setProject] = useState<Project | null>(null);
  const [sites, setSites]     = useState<JobSite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  useEffect(() => {
    if (!projectId) return;
    Promise.all([projectApi.get(projectId), siteApi.list(projectId)])
      .then(([pData, sData]) => {
        setProject(pData.project);
        setSites(sData.sites);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load sites'))
      .finally(() => setLoading(false));
  }, [projectId]);

  const canManage = user?.role === 'company_admin' || user?.role === 'project_manager';

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Skeleton className="h-4 w-40" />
        <div className="space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <Button variant="outline" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" /> Go back
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">

      <div>
        <Link
          href={`/projects/${projectId}`}
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {project?.name ?? 'Back to Project'}
        </Link>

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Job Sites</h1>
            {project && (
              <p className="mt-1 text-sm text-muted-foreground">{project.name}</p>
            )}
          </div>
          {canManage && (
            <Button size="sm">
              <Plus className="h-3.5 w-3.5" /> Add Site
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{sites.length} {sites.length === 1 ? 'Site' : 'Sites'}</CardTitle>
        </CardHeader>
        <Separator />
        <CardContent className="pt-4">
          {sites.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10">
              <Building2 className="h-10 w-10 text-muted-foreground/30 mb-3" />
              <p className="text-sm font-medium text-foreground">No job sites yet</p>
              {canManage && (
                <p className="mt-1 text-sm text-muted-foreground">
                  Add the first site for this project.
                </p>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {sites.map((site) => (
                <Link key={site.id} href={`/projects/${projectId}/sites/${site.id}`}>
                  <div className="group flex items-center justify-between rounded-lg border border-border bg-background px-4 py-3 transition-colors hover:bg-muted/50 hover:border-primary/30 cursor-pointer">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-foreground truncate text-sm group-hover:text-primary transition-colors">
                          {site.name}
                        </p>
                        {!site.isActive && (
                          <Badge variant="inactive" className="shrink-0">Inactive</Badge>
                        )}
                      </div>
                      {site.address && (
                        <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground truncate">
                          <MapPin className="h-3 w-3 shrink-0" />{site.address}
                        </p>
                      )}
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50 ml-3 group-hover:text-primary transition-colors" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
