'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { drawingApi, ApiError } from '@/lib/api';
import { projectApi } from '@/lib/api';
import { Drawing, Project } from '@/lib/types';
import { useAuthStore } from '@/store/auth.store';
import { PageHeader } from '@/components/ui/PageHeader';
import { SearchFilterBar } from '@/components/ui/SearchFilterBar';
import { EmptyState } from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { FileStack, FileCheck, AlertCircle, Plus, ChevronRight } from 'lucide-react';

const STATUS_LABELS: Record<string, string> = {
  draft:                    'Draft',
  issued_for_review:        'Issued for Review',
  issued_for_construction:  'Issued for Construction',
  superseded:               'Superseded',
  archived:                 'Archived',
};

const STATUS_VARIANT: Record<string, 'active' | 'inactive' | 'pending' | 'warning' | 'default'> = {
  draft:                   'pending',
  issued_for_review:       'warning',
  issued_for_construction: 'active',
  superseded:              'inactive',
  archived:                'inactive',
};

function DrawingStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={STATUS_VARIANT[status] ?? 'default'}>
      {STATUS_LABELS[status] ?? status}
    </Badge>
  );
}

export default function DrawingsPage() {
  const { user } = useAuthStore();
  const [projects, setProjects]     = useState<Project[]>([]);
  const [drawings, setDrawings]     = useState<Drawing[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [projectId, setProjectId]   = useState('');
  const [search, setSearch]         = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [disciplineFilter, setDisciplineFilter] = useState('');

  const canManage = user?.role === 'company_admin' || user?.role === 'project_manager';

  // Load projects for filter
  useEffect(() => {
    projectApi.list()
      .then((d) => {
        setProjects(d.projects);
        if (d.projects.length > 0 && !projectId) {
          setProjectId(d.projects[0].id);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    drawingApi.list(projectId, {
      search:     search || undefined,
      status:     statusFilter || undefined,
      discipline: disciplineFilter || undefined,
    })
      .then((d) => setDrawings(d.drawings))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load drawings'))
      .finally(() => setLoading(false));
  }, [projectId, search, statusFilter, disciplineFilter]);

  const currentProject = projects.find((p) => p.id === projectId);

  // Unique disciplines from loaded drawings
  const disciplines = [...new Set(drawings.map((d) => d.discipline).filter(Boolean))] as string[];

  const getCurrentRevision = (drawing: Drawing) =>
    drawing.revisions.find((r) => r.id === drawing.currentRevisionId) ?? drawing.revisions[0];

  return (
    <div className="px-6 py-8 space-y-6 animate-fade-in">
      <PageHeader
        title="Drawings"
        subtitle={projectId ? `${drawings.length} drawing${drawings.length !== 1 ? 's' : ''} in ${currentProject?.name ?? ''}` : 'Select a project'}
        action={
          canManage && projectId ? (
            <Link href={`/drawings/new?projectId=${projectId}`}>
              <Button><Plus className="h-4 w-4 mr-1" /> Add Drawing</Button>
            </Link>
          ) : undefined
        }
      />

      <SearchFilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by number, title, discipline…"
        filters={[
          {
            label: 'Project',
            value: projectId,
            options: projects.map((p) => ({ label: p.name, value: p.id })),
            onChange: setProjectId,
          },
          {
            label: 'Status',
            value: statusFilter,
            options: Object.entries(STATUS_LABELS).map(([value, label]) => ({ label, value })),
            onChange: setStatusFilter,
          },
          {
            label: 'Discipline',
            value: disciplineFilter,
            options: disciplines.map((d) => ({ label: d, value: d })),
            onChange: setDisciplineFilter,
          },
        ]}
      />

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!projectId ? (
        <EmptyState
          icon={<FileStack className="h-12 w-12" />}
          title="Select a project"
          description="Choose a project from the filter above to view its drawings."
        />
      ) : loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
      ) : drawings.length === 0 ? (
        <EmptyState
          icon={<FileStack className="h-12 w-12" />}
          title={search || statusFilter || disciplineFilter ? 'No drawings match your filter' : 'No drawings yet'}
          description={!search && !statusFilter && !disciplineFilter && canManage ? 'Upload the first drawing to get started.' : undefined}
          action={!search && !statusFilter && !disciplineFilter && canManage ? { label: 'Add Drawing', href: `/drawings/new?projectId=${projectId}` } : undefined}
        />
      ) : (
        <div className="space-y-2">
          {drawings.map((drawing) => {
            const current = getCurrentRevision(drawing);
            const isCurrent = current?.id === drawing.currentRevisionId;
            return (
              <Link key={drawing.id} href={`/drawings/${drawing.id}?projectId=${projectId}`}>
                <div className="group flex items-center justify-between rounded-xl border border-border bg-card px-4 py-4 transition-colors hover:bg-navy-elevated cursor-pointer">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                      <FileStack className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs text-muted-foreground">{drawing.drawingNumber}</span>
                        <p className="font-medium text-foreground group-hover:text-primary transition-colors truncate">
                          {drawing.title}
                        </p>
                        {drawing.discipline && (
                          <span className="text-xs text-muted-foreground">{drawing.discipline}</span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        {current ? (
                          <>
                            <DrawingStatusBadge status={current.status} />
                            {isCurrent && current.status === 'issued_for_construction' && (
                              <span className="flex items-center gap-1 text-xs text-emerald-600">
                                <FileCheck className="h-3 w-3" /> Current approved
                              </span>
                            )}
                            <span className="text-xs text-muted-foreground">Rev {current.revisionNumber}</span>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">No revisions</span>
                        )}
                        {drawing.site && (
                          <span className="text-xs text-muted-foreground">{drawing.site.name}</span>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {drawing.revisions.length} revision{drawing.revisions.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40 group-hover:text-primary transition-colors ml-3" />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
