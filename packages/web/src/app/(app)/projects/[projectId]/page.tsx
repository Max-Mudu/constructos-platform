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
import { EmptyState } from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { Skeleton } from '@/components/ui/Skeleton';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Separator } from '@/components/ui/Separator';
import { canCreateSite, canEditProject, statusLabel, statusVariant } from '@/lib/projects-admin-api';
import { canAddMembers, canListMembers, membersApi, type ProjectMember } from '@/lib/members-api';
import {
  Building2, MapPin, Calendar, ChevronRight, Users, AlertCircle, Plus, Pencil,
} from 'lucide-react';

export default function ProjectDetailPage() {
  const { projectId }         = useParams<{ projectId: string }>()!;
  const { user }              = useAuthStore();
  const [project, setProject] = useState<Project | null>(null);
  const [sites,   setSites]   = useState<JobSite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [members, setMembers] = useState<ProjectMember[] | null>(null);
  const [membersError, setMembersError] = useState('');

  // PATCH /projects/:id is company_admin only; sites are admin + PM.
  const canEdit       = canEditProject(user?.role);
  const canAddSite    = canCreateSite(user?.role);
  const canSeeMembers = canListMembers(user?.role);

  useEffect(() => {
    if (!projectId) return;
    Promise.all([projectApi.get(projectId), siteApi.list(projectId)])
      .then(([pData, sData]) => { setProject(pData.project); setSites(sData.sites); })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load project'))
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    if (!projectId || !canSeeMembers) return;
    membersApi.list(projectId)
      .then((d) => setMembers(d.members))
      .catch((err) => setMembersError(err instanceof ApiError ? err.message : 'Failed to load members'));
  }, [projectId, canSeeMembers]);

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

  const editButton = canEdit ? (
    <Link href={`/projects/${projectId}/edit`}>
      <Button variant="outline" size="sm"><Pencil className="h-3.5 w-3.5" /> Edit</Button>
    </Link>
  ) : undefined;

  return (
    <div className="animate-fade-in">
      <StickyActionsRow title={project.name} actions={editButton} />

      <div className="px-6 py-8 space-y-8">
        <div className="space-y-4">
          <Breadcrumb items={[{ label: 'Projects', href: '/projects' }, { label: project.name }]} />
          <PageHeader
            title={project.name}
            subtitle={subtitle || undefined}
            action={editButton}
          />
          <div className="flex flex-wrap gap-2">
            <Badge variant={statusVariant(project.status)}>{statusLabel(project.status)}</Badge>
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

        {/* Job Sites */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Job Sites</CardTitle>
              {canAddSite && (
                <Link href={`/projects/${projectId}/sites/new`}>
                  <Button variant="outline" size="sm"><Plus className="h-3.5 w-3.5" /> Add Site</Button>
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
                description={canAddSite ? 'Add the first site to start recording daily work.' : undefined}
                action={canAddSite ? { label: 'Add Site', href: `/projects/${projectId}/sites/new` } : undefined}
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

        {/* Members — GET /members is company_admin / project_manager only */}
        {canSeeMembers && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <CardTitle>Project Members</CardTitle>
                  {members && members.length > 0 && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{members.length}</span>
                  )}
                </div>
                <Link href={`/projects/${projectId}/members`}>
                  <Button variant="outline" size="sm">
                    {canAddMembers(user?.role) ? 'Manage Members' : 'View Members'}
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <Separator />
            <CardContent className="pt-4">
              {membersError ? (
                <p className="text-sm text-red-400">{membersError}</p>
              ) : members === null ? (
                <Skeleton className="h-6 w-48" />
              ) : members.length === 0 ? (
                <p className="text-sm text-muted-foreground">No members assigned yet.</p>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {members.slice(0, 8).map((m) => (
                    <li key={m.id} className="rounded-full border border-border px-3 py-1 text-xs text-foreground">
                      {m.user.firstName} {m.user.lastName}
                      {m.site && <span className="text-muted-foreground"> · {m.site.name}</span>}
                    </li>
                  ))}
                  {members.length > 8 && (
                    <li className="px-2 py-1 text-xs text-muted-foreground">+{members.length - 8} more</li>
                  )}
                </ul>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
