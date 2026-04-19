'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { projectApi, siteApi, ApiError } from '@/lib/api';
import { Project, JobSite } from '@/lib/types';
import { useAuthStore } from '@/store/auth.store';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { PageHeader } from '@/components/ui/PageHeader';
import { StickyActionsRow } from '@/components/ui/StickyActionsRow';
import { QuickActions } from '@/components/ui/QuickActions';
import { EmptyState } from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { Skeleton } from '@/components/ui/Skeleton';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Separator } from '@/components/ui/Separator';
import {
  Building2, MapPin, Calendar, ChevronRight, Users, Plus, AlertCircle,
} from 'lucide-react';

function statusVariant(s: string): 'active' | 'pending' | 'secondary' | 'inactive' {
  if (s === 'active')    return 'active';
  if (s === 'on_hold')   return 'pending';
  if (s === 'completed') return 'secondary';
  return 'inactive';
}

export default function ProjectDetailPage() {
  const { projectId }         = useParams<{ projectId: string }>();
  const { user }              = useAuthStore();
  const [project, setProject] = useState<Project | null>(null);
  const [sites,   setSites]   = useState<JobSite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    if (!projectId) return;
    Promise.all([projectApi.get(projectId), siteApi.list(projectId)])
      .then(([pData, sData]) => { setProject(pData.project); setSites(sData.sites); })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load project'))
      .finally(() => setLoading(false));
  }, [projectId]);

  const canManage = user?.role === 'company_admin' || user?.role === 'project_manager';

  if (loading) {
    return (
      <div className="px-6 py-8 space-y-6 animate-fade-in">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-6 py-8">
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!project) return null;

  const subtitle = [
    project.location,
    project.startDate && new Date(project.startDate).toLocaleDateString(),
  ].filter(Boolean).join(' · ');

  return (
    <div className="animate-fade-in">
      <StickyActionsRow
        title={project.name}
        actions={canManage ? <Button variant="outline" size="sm">Edit</Button> : undefined}
      />

      <div className="px-6 py-8 space-y-8">
        <div className="space-y-4">
          <Breadcrumb items={[{ label: 'Projects', href: '/projects' }, { label: project.name }]} />
          <PageHeader
            title={project.name}
            subtitle={subtitle || undefined}
            action={canManage ? <Button variant="outline" size="sm">Edit</Button> : undefined}
          />
          <div className="flex flex-wrap gap-2">
            <Badge variant={statusVariant(project.status)}>{project.status.replace(/_/g, ' ')}</Badge>
            {project.code && <span className="font-mono text-xs text-muted-foreground self-center">{project.code}</span>}
          </div>
          {project.description && (
            <p className="text-sm text-muted-foreground">{project.description}</p>
          )}
          <div className="flex flex-wrap gap-4">
            {project.location && (
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <MapPin className="h-4 w-4" />{project.location}
              </span>
            )}
            {project.startDate && (
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Calendar className="h-4 w-4" />
                {new Date(project.startDate).toLocaleDateString()}
                {project.endDate && ` – ${new Date(project.endDate).toLocaleDateString()}`}
              </span>
            )}
          </div>
        </div>

        {canManage && (
          <QuickActions
            title="Quick Actions"
            actions={[
              { label: 'Add Site', icon: <Plus className="h-4 w-4" />, href: `/projects/${projectId}/sites/new`, variant: 'primary' },
            ]}
          />
        )}

        {/* Job Sites */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Job Sites</CardTitle>
              {canManage && (
                <Link href={`/projects/${projectId}/sites/new`}>
                  <Button size="sm"><Plus className="h-3.5 w-3.5" /> Add Site</Button>
                </Link>
              )}
            </div>
          </CardHeader>
          <Separator />
          <CardContent className="pt-4">
            {sites.length === 0 ? (
              <EmptyState
                icon={<Building2 className="h-10 w-10" />}
                title="No job sites yet"
                description={canManage ? 'Add the first site to this project.' : undefined}
                action={canManage ? { label: 'Add Site', href: `/projects/${projectId}/sites/new` } : undefined}
              />
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {sites.map((site) => (
                  <Link key={site.id} href={`/projects/${projectId}/sites/${site.id}`}>
                    <div className="group flex items-center justify-between rounded-lg border border-border bg-navy-base px-4 py-3 transition-colors hover:bg-navy-elevated cursor-pointer">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-foreground truncate text-sm group-hover:text-primary transition-colors">
                            {site.name}
                          </p>
                          {!site.isActive && <Badge variant="inactive" className="shrink-0">Inactive</Badge>}
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

        {/* Members */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <CardTitle>Project Members</CardTitle>
              </div>
              {user?.role === 'company_admin' && (
                <Button variant="outline" size="sm">Manage Members</Button>
              )}
            </div>
          </CardHeader>
          <Separator />
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Member list will appear here.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
