'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { projectApi, ApiError } from '@/lib/api';
import { Project } from '@/lib/types';
import { PageHeader } from '@/components/ui/PageHeader';
import { SearchFilterBar } from '@/components/ui/SearchFilterBar';
import { EmptyState } from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { useAuthStore } from '@/store/auth.store';
import {
  canCreateProject, selectableStatuses, statusLabel, statusVariant,
} from '@/lib/projects-admin-api';
import { Building2, MapPin, Calendar, ChevronRight, AlertCircle, Plus } from 'lucide-react';

// The API enum is planning/active/on_hold/completed/archived; archived
// projects are never returned by GET /projects, so they are not a filter.
const STATUS_OPTIONS = selectableStatuses();

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [search,   setSearch]   = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const user = useAuthStore((s) => s.user);
  const canCreate = canCreateProject(user?.role);

  useEffect(() => {
    projectApi.list()
      .then((d) => setProjects(d.projects))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  const filtered = projects.filter((p) => {
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase());
    const matchStatus = !statusFilter || p.status === statusFilter;
    return matchSearch && matchStatus;
  });

  return (
    <div className="px-6 py-8 space-y-6 animate-fade-in">
      <PageHeader
        title="Projects"
        subtitle={`${projects.length} project${projects.length !== 1 ? 's' : ''} total`}
        action={canCreate ? (
          <Link href="/projects/new">
            <Button><Plus className="h-4 w-4" /> New Project</Button>
          </Link>
        ) : undefined}
      />

      <SearchFilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search projects…"
        filters={[
          {
            label: 'Status',
            value: statusFilter,
            options: STATUS_OPTIONS,
            onChange: setStatusFilter,
          },
        ]}
      />

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Building2 className="h-12 w-12" />}
          title={search || statusFilter ? 'No projects match your filter' : 'No projects yet'}
          description={!search && !statusFilter && !canCreate
            ? 'Ask your company admin to add you to a project.'
            : undefined}
          action={!search && !statusFilter && canCreate ? { label: 'New Project', href: '/projects/new' } : undefined}
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}`}>
              <div className="group flex items-center justify-between rounded-xl border border-border bg-card px-4 py-4 transition-colors hover:bg-navy-elevated cursor-pointer">
                <div className="flex items-center gap-4 min-w-0">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <Building2 className="h-5 w-5 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-foreground group-hover:text-primary transition-colors truncate">
                        {p.name}
                      </p>
                      <Badge variant={statusVariant(p.status)}>
                        {statusLabel(p.status)}
                      </Badge>
                      {p.code && (
                        <span className="font-mono text-xs text-muted-foreground">{p.code}</span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-4">
                      {p.location && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <MapPin className="h-3 w-3" />{p.location}
                        </span>
                      )}
                      {p.startDate && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Calendar className="h-3 w-3" />
                          {new Date(p.startDate).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40 group-hover:text-primary transition-colors ml-3" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
